package sql

import (
	"context"
	"errors"
	"fmt"
	"math"
	"math/rand"
	"time"

	bulker "github.com/jitsucom/bulker/bulkerlib"
	"github.com/jitsucom/bulker/bulkerlib/types"
	"github.com/jitsucom/bulker/jitsubase/errorj"
	"github.com/jitsucom/bulker/jitsubase/logging"
	"github.com/jitsucom/bulker/jitsubase/timestamp"
	"github.com/jitsucom/bulker/jitsubase/utils"
)

// TODO: Use real temporary tables
type TransactionalStream struct {
	*AbstractTransactionalSQLStream
}

func newTransactionalStream(id string, p SQLAdapter, tableName string, streamOptions ...bulker.StreamOption) (bulker.BulkerStream, error) {
	ps := TransactionalStream{}
	var err error
	so := bulker.StreamOptions{}
	for _, opt := range streamOptions {
		so.Add(opt)
	}
	disableTemporaryTables := DisableTemporaryTables.Get(&so)

	ps.AbstractTransactionalSQLStream, err = newAbstractTransactionalStream(id, p, tableName, bulker.Batch, streamOptions...)
	if err != nil {
		return nil, err
	}
	ps.loadExistingTable = true
	ps.tmpTableFunc = func(ctx context.Context, tableForObject *Table, object types.Object) (table *Table) {
		tmpTable := tableForObject.WithoutColumns()
		if ps.schemaFromOptions != nil {
			ps.adjustTableColumnTypes(tmpTable, ps.existingTable, ps.schemaFromOptions, nil)
		}
		ps.adjustTableColumnTypes(tmpTable, ps.existingTable, tableForObject, object)
		tmpTableName := fmt.Sprintf("%s_tmp%d%03d", utils.ShortenString(ps.tableName, 43), time.Now().UnixMilli(), rand.Intn(1000))
		t := &Table{
			Namespace:       utils.Ternary(disableTemporaryTables, ps.namespace, p.TmpNamespace(ps.namespace)),
			Name:            tmpTableName,
			Columns:         tmpTable.Columns,
			Temporary:       !disableTemporaryTables,
			TimestampColumn: tableForObject.TimestampColumn,
		}
		if p.TmpTableUsePK() {
			t.PKFields = tableForObject.PKFields
		}
		return t
	}
	return &ps, nil
}

func (ps *TransactionalStream) Complete(ctx context.Context) (state bulker.State, err error) {
	if ps.state.Status != bulker.Active {
		return ps.state, errors.New("stream is not active")
	}
	defer func() {
		state, err = ps.postComplete(ctx, err)
	}()
	//if at least one object was inserted
	if ps.state.SuccessfulRows > 0 {
		if ps.localBatchFileName != "" {
			ws, err := ps.flushBatchFile(ctx)
			ps.state.AddWarehouseState(ws)
			if err != nil {
				return ps.state, err
			}
		}
		var dstTable *Table
		dstTable, err = ps.sqlAdapter.TableHelper().EnsureTableWithCaching(ctx, ps.tx, ps.id, ps.dstTable)
		if err != nil {
			ps.updateRepresentationTable(ps.dstTable)
			return ps.state, errorj.Decorate(err, "failed to ensure destination table")
		}
		// TODO: workaround: we cannot currently get sort key column from system table in redshift IAM driver
		if ps.timestampColumn != "" && dstTable.TimestampColumn == "" {
			c, ok := dstTable.Columns.Get(ps.timestampColumn)
			if ok && c.DataType == types.TIMESTAMP {
				dstTable.TimestampColumn = ps.timestampColumn
			}
		}
		ps.dstTable = dstTable
		ps.updateRepresentationTable(ps.dstTable)
		mergeWindowDays := ps.mergeWindow
		if mergeWindowDays > 0 {
			if !ps.minTimestampInBatch.IsZero() {
				batchInterval := timestamp.Now().Sub(*ps.minTimestampInBatch)
				mergeWindowDays = int(math.Ceil(batchInterval.Hours() / 24))
				mergeWindowDays = min(mergeWindowDays, ps.mergeWindow)
				mergeWindowDays = max(mergeWindowDays, 1)
			}
			logging.Infof("[%s] Merge window set to %d days. Min ts: %s", ps.id, mergeWindowDays, ps.minTimestampInBatch.Format(time.RFC3339))
		}
		//copy data from tmp table to destination table
		ws, err := ps.tx.CopyTables(ctx, ps.dstTable, ps.tmpTable, mergeWindowDays, ps.discriminatorColumn)
		ps.state.AddWarehouseState(ws)
		if err != nil {
			return ps.state, err
		}
		return ps.state, nil
	} else {
		//if was any error - it will trigger transaction rollback in defer func
		err = ps.state.LastError
		return
	}
}
