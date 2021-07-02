package storages

import (
	"fmt"
	"strings"
	"time"

	"github.com/jitsucom/jitsu/server/adapters"
	"github.com/jitsucom/jitsu/server/events"
	"github.com/jitsucom/jitsu/server/logging"
	"github.com/jitsucom/jitsu/server/schema"
)

func dryRun(payload events.Event, processor *schema.Processor, tableHelper *TableHelper) ([]adapters.TableField, error) {
	batchHeader, event, err := processor.ProcessEvent(payload)
	if err != nil {
		return nil, err
	}

	tableSchema := tableHelper.MapTableSchema(batchHeader)
	var dryRunResponses []adapters.TableField

	for name, column := range tableSchema.Columns {
		dryRunResponses = append(dryRunResponses, adapters.TableField{Field: name, Type: column.SQLType, Value: event[name]})
	}

	return dryRunResponses, nil
}

func isConnectionError(err error) bool {
	return strings.Contains(err.Error(), "connection refused") ||
		strings.Contains(err.Error(), "EOF") ||
		strings.Contains(err.Error(), "write: broken pipe") ||
		strings.Contains(err.Error(), "context deadline exceeded") ||
		strings.Contains(err.Error(), "connection reset by peer") ||
		strings.Contains(err.Error(), "write: connection timed out")
}

// syncStoreImpl implements common behaviour used to storing chunk of pulled data to any storages with processing
func syncStoreImpl(storage Storage, overriddenDataSchema *schema.BatchHeader, objects []map[string]interface{}, timeIntervalValue string, cacheTable bool) error {
	adapter, tableHelper := storage.getAdapters()

	processor := storage.Processor()
	if processor == nil {
		return fmt.Errorf("Storage '%v' of '%v' type was badly configured", storage.ID(), storage.Type())
	}

	flatData, err := processor.ProcessPulledEvents(timeIntervalValue, objects)
	if err != nil {
		return err
	}

	deleteConditions := adapters.DeleteByTimeChunkCondition(timeIntervalValue)

	// table schema overridden (is used by Singer sources)
	if overriddenDataSchema != nil && len(overriddenDataSchema.Fields) > 0 {
		var data []map[string]interface{}

		// ignore table multiplexing from mapping step
		for _, fdata := range flatData {
			data = append(data, fdata.GetPayload()...)

			// enrich overridden schema with new fields (some system fields or e.g. after lookup step)
			overriddenDataSchema.Fields.Add(fdata.BatchHeader.Fields)
		}

		table := tableHelper.MapTableSchema(overriddenDataSchema)

		dbSchema, err := tableHelper.EnsureTable(storage.ID(), table, cacheTable)
		if err != nil {
			return err
		}

		start := time.Now()
		if err = adapter.BulkUpdate(dbSchema, data, deleteConditions); err != nil {
			return err
		}

		logging.Debugf("[%s] Inserted [%d] rows in [%.2f] seconds", storage.ID(), len(data), time.Now().Sub(start).Seconds())
		return nil
	}

	// plain flow
	for _, fdata := range flatData {
		table := tableHelper.MapTableSchema(fdata.BatchHeader)

		// overridden table destinationID
		if overriddenDataSchema != nil && overriddenDataSchema.TableName != "" {
			table.Name = overriddenDataSchema.TableName
		}

		dbSchema, err := tableHelper.EnsureTable(storage.ID(), table, cacheTable)
		if err != nil {
			return err
		}

		start := time.Now()
		if err := adapter.BulkUpdate(dbSchema, fdata.GetPayload(), deleteConditions); err != nil {
			return err
		}

		logging.Debugf("[%s] Inserted [%d] rows in [%.2f] seconds", storage.ID(), len(fdata.GetPayload()), time.Now().Sub(start).Seconds())
	}

	return nil
}
