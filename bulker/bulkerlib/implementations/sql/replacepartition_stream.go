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
	"github.com/jitsucom/bulker/jitsubase/jsonorder"
	"github.com/jitsucom/bulker/jitsubase/logging"
	"github.com/jitsucom/bulker/jitsubase/timestamp"
	"github.com/jitsucom/bulker/jitsubase/utils"
)

type ReplacePartitionStream struct {
	*AbstractTransactionalSQLStream
	partitionId string
}

func newReplacePartitionStream(id string, p SQLAdapter, tableName string, streamOptions ...bulker.StreamOption) (stream bulker.BulkerStream, err error) {
	ps := ReplacePartitionStream{}
	so := bulker.StreamOptions{}
	for _, opt := range streamOptions {
		so.Add(opt)
	}
	partitionId := bulker.PartitionIdOption.Get(&so)
	disableTemporaryTables := DisableTemporaryTables.Get(&so)

	if partitionId == "" {
		return nil, errors.New("WithPartition is required option for ReplacePartitionStream")
	}
	ps.AbstractTransactionalSQLStream, err = newAbstractTransactionalStream(id, p, tableName, bulker.ReplacePartition, streamOptions...)
	if err != nil {
		return nil, err
	}
	ps.partitionId = partitionId
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

func (ps *ReplacePartitionStream) ConsumeJSON(ctx context.Context, json []byte) (state bulker.State, processedObject types.Object, err error) {
	var obj types.Object
	err = jsonorder.Unmarshal(json, &obj)
	if err != nil {
		return ps.state, nil, fmt.Errorf("Error parsing JSON: %v", err)
	}
	return ps.Consume(ctx, obj)
}

func (ps *ReplacePartitionStream) ConsumeMap(ctx context.Context, mp map[string]any) (state bulker.State, processedObject types.Object, err error) {
	return ps.Consume(ctx, types.ObjectFromMap(mp))
}

func (ps *ReplacePartitionStream) Consume(ctx context.Context, object types.Object) (state bulker.State, processedObjects types.Object, err error) {
	objCopy := types.NewObject(object.Len() + 1)
	objCopy.Set(PartitonIdKeyword, ps.partitionId)
	objCopy.SetAll(object)
	return ps.AbstractTransactionalSQLStream.Consume(ctx, objCopy)
}

func (ps *ReplacePartitionStream) Complete(ctx context.Context) (state bulker.State, err error) {
	if ps.state.Status != bulker.Active {
		return ps.state, errors.New("stream is not active")
	}
	defer func() {
		state, err = ps.postComplete(ctx, err)
	}()
	//if no error happened during inserts. empty stream is valid - means no data for sync period
	if ps.state.LastError == nil {
		//we have to clear all previous data even if no objects was consumed
		//if stream was empty we need to open transaction.
		if err = ps.initTx(ctx); err != nil {
			return
		}
		err = ps.clearPartition(ctx, ps.tx)
		if err == nil && ps.state.SuccessfulRows > 0 {
			if ps.localBatchFileName != "" {
				ws, err := ps.flushBatchFile(ctx)
				ps.state.AddWarehouseState(ws)
				if err != nil {
					return ps.state, err
				}
			}
			var dstTable *Table
			dstTable, err = ps.sqlAdapter.TableHelper().EnsureTableWithoutCaching(ctx, ps.tx, ps.id, ps.dstTable)
			if err != nil {
				ps.updateRepresentationTable(ps.dstTable)
				return ps.state, errorj.Decorate(err, "failed to ensure destination table")
			}
			ps.dstTable = dstTable
			ps.updateRepresentationTable(ps.dstTable)
			//copy data from tmp table to destination table
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
			ws, err := ps.tx.CopyTables(ctx, ps.dstTable, ps.tmpTable, mergeWindowDays, ps.discriminatorColumn)
			ps.state.AddWarehouseState(ws)
			if err != nil {
				return ps.state, err
			}
		}
		return
	} else {
		//if was any error - it will trigger transaction rollback in defer func
		err = ps.state.LastError
		return
	}
}

func (ps *ReplacePartitionStream) clearPartition(ctx context.Context, tx *TxSQLAdapter) error {
	//check if destination table already exists
	table, err := tx.GetTableSchema(ctx, ps.namespace, ps.tableName)
	if err != nil {
		return fmt.Errorf("couldn't start ReplacePartitionStream: failed to check existence of table: %s error: %s", ps.tableName, err)
	}
	if table.Exists() {
		//if table exists we need to delete previous data associated with partitionId,
		//but we need to check if partitionId column exists in table first
		_, ok := table.Columns.Get(tx.ColumnName(PartitonIdKeyword))
		if !ok {
			return fmt.Errorf("couldn't start ReplacePartitionStream: destination table [%s] exist but it is not managed by ReplacePartitionStream: %s column is missing", ps.tableName, tx.ColumnName(PartitonIdKeyword))
		}
		//delete previous data by provided partition id
		err = tx.Delete(ctx, ps.namespace, ps.tableName, ByPartitionId(ps.partitionId))
		if err != nil {
			return fmt.Errorf("couldn't start ReplacePartitionStream: failed to delete data for partitionId: %s error: %s", ps.partitionId, err)
		}
	}
	return nil
}
