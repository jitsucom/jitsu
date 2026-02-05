package sql

import (
	"context"
	"errors"
	"fmt"
	"math/rand"
	"time"

	"github.com/hashicorp/go-multierror"
	bulker "github.com/jitsucom/bulker/bulkerlib"
	"github.com/jitsucom/bulker/bulkerlib/types"
	"github.com/jitsucom/bulker/jitsubase/errorj"
	"github.com/jitsucom/bulker/jitsubase/logging"
	"github.com/jitsucom/bulker/jitsubase/utils"
	"github.com/joomcode/errorx"
)

type ReplaceTableStream struct {
	*AbstractTransactionalSQLStream
}

func newReplaceTableStream(id string, p SQLAdapter, tableName string, streamOptions ...bulker.StreamOption) (bulker.BulkerStream, error) {
	ps := ReplaceTableStream{}

	var err error
	ps.AbstractTransactionalSQLStream, err = newAbstractTransactionalStream(id, p, tableName, bulker.ReplaceTable, streamOptions...)
	ps.doLocalDeduplication = true
	if err != nil {
		return nil, err
	}
	ps.tmpTableFunc = func(ctx context.Context, tableForObject *Table, object types.Object) (table *Table) {
		columns := tableForObject.Columns
		if ps.schemaFromOptions != nil {
			columns = ps.schemaFromOptions.Columns.Copy()
		}
		tmpTable := &Table{
			Namespace:       ps.namespace,
			Name:            fmt.Sprintf("%s_tmp%d%03d", utils.ShortenString(ps.tableName, 43), time.Now().UnixMilli(), rand.Intn(1000)),
			PKFields:        tableForObject.PKFields,
			Columns:         columns,
			TimestampColumn: tableForObject.TimestampColumn,
		}
		if ps.schemaFromOptions != nil {
			ps.adjustTableColumnTypes(tmpTable, nil, tableForObject, object)
		}
		return tmpTable
	}
	return &ps, nil
}

func (ps *ReplaceTableStream) Complete(ctx context.Context) (state bulker.State, err error) {
	if ps.state.Status != bulker.Active {
		return ps.state, errors.New("stream is not active")
	}
	defer func() {
		state, err = ps.postComplete(ctx, err)
	}()
	if ps.state.LastError == nil {
		//if at least one object was inserted
		if ps.state.SuccessfulRows > 0 {
			if ps.localBatchFileName != "" {
				ws, err := ps.flushBatchFile(ctx)
				ps.state.AddWarehouseState(ws)
				if err != nil {
					return ps.state, err
				}
			}
			r, ok := ps.state.Representation.(RepresentationTable)
			if ok {
				r.Name = ps.tableName
				r.Temporary = false
				ps.state.Representation = r
			}
			err1 := ps.tx.ReplaceTable(ctx, ps.tableName, ps.tmpTable, true)
			if err1 != nil {
				logging.Errorf("[%s] Error replacing table: %v", ps.id, err1)
			}
			if errorx.IsOfType(err1, errorj.DropError) {
				err = ps.tx.ReplaceTable(ctx, ps.tableName, ps.tmpTable, false)
				if err != nil {
					err = multierror.Append(err1, err).ErrorOrNil()
				}
			} else {
				err = err1
			}
			if err != nil {
				return ps.state, err
			}
		} else {
			//when no objects were consumed. we need to replace table with empty one.
			//truncation seems like a more straightforward approach.
			if ps.sqlAdapter.Type() == PostgresBulkerTypeId {
				// workaround for neon search_path issue
				err = ps.initTx(ctx)
				if err == nil {
					var table *Table
					table, err = ps.tx.GetTableSchema(ctx, ps.namespace, ps.tableName)
					if table.Exists() {
						err = ps.tx.TruncateTable(ctx, ps.namespace, ps.tableName)
					}
				}
			} else {
				//no transaction was opened yet and not needed that is why we use ps.sqlAdapter instead of tx
				var table *Table
				table, err = ps.sqlAdapter.GetTableSchema(ctx, ps.namespace, ps.tableName)
				if table.Exists() {
					err = ps.sqlAdapter.TruncateTable(ctx, ps.namespace, ps.tableName)
				}
			}
		}
		return
	} else {
		//if was any error - it will trigger transaction rollback in defer func
		err = ps.state.LastError
		return
	}
}
