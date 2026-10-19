package sql

import (
	"context"
	"fmt"
	"time"

	bulker "github.com/jitsucom/bulker/bulkerlib"
	"github.com/jitsucom/bulker/bulkerlib/types"
	"github.com/jitsucom/bulker/jitsubase/errorj"
	"github.com/jitsucom/bulker/jitsubase/jsonorder"
)

// existingTableRefreshInterval bounds how long AutoCommitStream can run on a
// destination-schema snapshot that has drifted from reality (e.g. a column
// dropped out-of-band). Hardcoded, no env var/toggle. Time-triggered, not
// error-triggered: a destination outage must not add load on top of every
// failing insert. 1h per Ildar - a schema fetch is a cheap catalog query,
// no reason to wait longer. See JITSU-237.
const existingTableRefreshInterval = 1 * time.Hour

type AutoCommitStream struct {
	*AbstractSQLStream
}

func newAutoCommitStream(id string, p SQLAdapter, tableName string, streamOptions ...bulker.StreamOption) (bulker.BulkerStream, error) {
	ps := AutoCommitStream{}
	var err error
	ps.AbstractSQLStream, err = newAbstractStream(id, p, tableName, bulker.Stream, streamOptions...)
	if err != nil {
		return nil, err
	}

	return &ps, nil
}

func (ps *AutoCommitStream) ConsumeJSON(ctx context.Context, json []byte) (state bulker.State, processedObject types.Object, err error) {
	var obj types.Object
	err = jsonorder.Unmarshal(json, &obj)
	if err != nil {
		return ps.state, nil, fmt.Errorf("Error parsing JSON: %v", err)
	}
	return ps.Consume(ctx, obj)
}

func (ps *AutoCommitStream) ConsumeMap(ctx context.Context, mp map[string]any) (state bulker.State, processedObject types.Object, err error) {
	return ps.Consume(ctx, types.ObjectFromMap(mp))
}

func (ps *AutoCommitStream) Consume(ctx context.Context, object types.Object) (state bulker.State, processedObject types.Object, err error) {
	defer func() {
		if err != nil {
			ps.sqlAdapter.TableHelper().ClearCached(ps.sqlAdapter.NamespaceName(ps.namespace), ps.tableName)
		}
		err = ps.postConsume(err)
		state = ps.state
	}()
	if err = ps.init(ctx); err != nil {
		return
	}
	table, processedObject, err := ps.preprocess(object, false)
	if err != nil {
		return
	}
	if ps.existingTable == nil {
		ps.existingTable, _ = ps.sqlAdapter.TableHelper().Get(ctx, ps.sqlAdapter, ps.namespace, ps.tableName, true)
		ps.existingTableFetchedAt = time.Now()
	} else if time.Since(ps.existingTableFetchedAt) >= existingTableRefreshInterval {
		// cacheTable=false: bypass the shared TableHelper cache so this
		// actually re-reads the real schema instead of returning the same
		// stale shared entry.
		if fresh, fetchErr := ps.sqlAdapter.TableHelper().Get(ctx, ps.sqlAdapter, ps.namespace, ps.tableName, false); fetchErr == nil {
			ps.existingTable = fresh
		}
		// Stamp the attempt regardless of outcome - a failed refresh (e.g.
		// the destination is down) must wait for the next interval, not
		// retry on every subsequent Consume() call.
		ps.existingTableFetchedAt = time.Now()
	}

	if ps.existingTable.Exists() {
		if ps.initialColumnsCount == 0 {
			ps.initialColumnsCount = ps.existingTable.ColumnsCount()
		}
		currentTable := table.WithoutColumns()
		if ps.schemaFromOptions != nil {
			//just to convert values to schema data types
			ps.adjustTableColumnTypes(currentTable, ps.existingTable, ps.schemaFromOptions, processedObject)
		}
		columnsAdded := ps.adjustTableColumnTypes(currentTable, ps.existingTable, table, processedObject)
		if columnsAdded || !currentTable.PKFields.Equals(ps.existingTable.PKFields) {
			ps.updateRepresentationTable(currentTable)
			// if new columns were added - update table. (for _unmapped_data column)
			ps.existingTable, err = ps.sqlAdapter.TableHelper().EnsureTableWithCaching(ctx, ps.sqlAdapter, ps.id, currentTable)
			if err != nil {
				// give another try without using table cache
				ps.existingTable, err = ps.sqlAdapter.TableHelper().EnsureTableWithoutCaching(ctx, ps.sqlAdapter, ps.id, currentTable)
				if err != nil {
					ps.updateRepresentationTable(currentTable)
					err = errorj.Decorate(err, "failed to ensure table")
					return
				}
				// here this method only tries to convert values to existing column types
				columnsAdded = ps.adjustTableColumnTypes(currentTable, ps.existingTable, table, processedObject)
				if columnsAdded {
					ps.updateRepresentationTable(currentTable)
					// if new columns were added - update table. (for _unmapped_data column)
					ps.existingTable, err = ps.sqlAdapter.TableHelper().EnsureTableWithCaching(ctx, ps.sqlAdapter, ps.id, currentTable)
					if err != nil {
						err = errorj.Decorate(err, "failed to ensure table")
						return
					}
				}
			}
		}
		ps.updateRepresentationTable(currentTable)
		// remove columns with missed data from Insert statements
		for el := currentTable.Columns.Front(); el != nil; {
			name := el.Key
			curEl := el
			// move to the next element before deleting the current one. otherwise iteration will be broken
			el = el.Next()
			v, ok := processedObject.Get(name)
			if !ok || v == nil {
				currentTable.Columns.DeleteElement(curEl)
			}
		}
		currentTable.PrimaryKeyName = ps.existingTable.PrimaryKeyName
		err = ps.sqlAdapter.Insert(ctx, currentTable, ps.merge, processedObject)
	} else {
		if ps.schemaFromOptions != nil {
			desiredTable := table.Clone()
			//just to convert values to schema data types
			ps.adjustTableColumnTypes(table, nil, ps.schemaFromOptions, nil)
			ps.adjustTableColumnTypes(table, nil, desiredTable, processedObject)
		}
		var existingTable *Table
		existingTable, err = ps.sqlAdapter.TableHelper().EnsureTableWithCaching(ctx, ps.sqlAdapter, ps.id, table)
		if err != nil {
			err = errorj.Decorate(err, "failed to ensure table")
			return
		}
		ps.existingTable = existingTable
		ps.updateRepresentationTable(ps.existingTable)
		currentTable := ps.existingTable.Clone()
		// remove columns with missed data from Insert statements
		for el := currentTable.Columns.Front(); el != nil; {
			name := el.Key
			curEl := el
			// move to the next element before deleting the current one. otherwise iteration will be broken
			el = el.Next()
			v, ok := processedObject.Get(name)
			if !ok || v == nil {
				currentTable.Columns.DeleteElement(curEl)
			}
		}
		err = ps.sqlAdapter.Insert(ctx, currentTable, ps.merge, processedObject)
	}

	return ps.state, processedObject, err
}

func (ps *AutoCommitStream) Complete(ctx context.Context) (state bulker.State, err error) {
	ps.state.Status = bulker.Completed
	return ps.state, nil
}

func (ps *AutoCommitStream) Abort(ctx context.Context) (state bulker.State) {
	ps.state.Status = bulker.Aborted
	return ps.state
}
