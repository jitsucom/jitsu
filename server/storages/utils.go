package storages

import (
	"errors"
	"fmt"
	"github.com/hashicorp/go-multierror"
	"github.com/jitsucom/jitsu/server/adapters"
	"github.com/jitsucom/jitsu/server/caching"
	"github.com/jitsucom/jitsu/server/drivers/base"
	"github.com/jitsucom/jitsu/server/events"
	"github.com/jitsucom/jitsu/server/logging"
	"github.com/jitsucom/jitsu/server/schema"
	"github.com/jitsucom/jitsu/server/timestamp"
	"strings"
)

func dryRun(payload events.Event, processor *schema.Processor, tableHelper *TableHelper) ([][]adapters.TableField, error) {
	envelops, err := processor.ProcessEvent(payload, true)
	if err != nil {
		return nil, err
	}
	res := make([][]adapters.TableField, 0, len(envelops))
	for _, envelop := range envelops {
		batchHeader := envelop.Header
		event := envelop.Event
		tableSchema := tableHelper.MapTableSchema(batchHeader)
		var tableFields []adapters.TableField

		for name, column := range tableSchema.Columns {
			tableFields = append(tableFields, adapters.TableField{Field: name, Type: column.Type, Value: event[name]})
		}
		res = append(res, tableFields)
	}
	return res, nil
}

func IsConnectionError(err error) bool {
	return strings.Contains(err.Error(), "connection refused") ||
		strings.Contains(err.Error(), "EOF") ||
		strings.Contains(err.Error(), "write: broken pipe") ||
		strings.Contains(err.Error(), "context deadline exceeded") ||
		strings.Contains(err.Error(), "connection reset by peer") ||
		strings.Contains(err.Error(), "timed out") ||
		strings.Contains(err.Error(), "no such host")
}

// syncStoreImpl implements common behaviour used to storing chunk of pulled data to any storages with processing
func syncStoreImpl(storage Storage, overriddenDataSchema *schema.BatchHeader, objects []map[string]interface{}, deleteConditions *base.DeleteConditions, cacheTable bool, needCopyEvent bool) error {
	if len(objects) == 0 {
		return nil
	}

	adapter, tableHelper := storage.getAdapters()

	flatDataPerTable, err := processData(storage, overriddenDataSchema, objects, "", needCopyEvent)
	if err != nil {
		return err
	}

	if deleteConditions == nil {
		deleteConditions = &base.DeleteConditions{}
	}

	for _, flatData := range flatDataPerTable {
		table := tableHelper.MapTableSchema(flatData.BatchHeader)

		dbSchema, err := tableHelper.EnsureTable(storage.ID(), table, cacheTable)
		if err != nil {
			return err
		}

		start := timestamp.Now()
		if err = adapter.Insert(adapters.NewBatchInsertContext(dbSchema, flatData.GetPayload(), deleteConditions)); err != nil {
			return err
		}
		logging.Debugf("[%s] Inserted [%d] rows in [%.2f] seconds", storage.ID(), flatData.GetPayloadLen(), timestamp.Now().Sub(start).Seconds())
	}

	return nil
}

//cleanImpl implements common table cleaning
func cleanImpl(storage Storage, tableName string) error {
	adapter, _ := storage.getAdapters()
	return adapter.Truncate(tableName)
}

func processData(storage Storage, overriddenDataSchema *schema.BatchHeader, objects []map[string]interface{}, fileName string, needCopyEvent bool) (map[string]*schema.ProcessedFile, error) {
	processor := storage.Processor()
	if processor == nil {
		return nil, fmt.Errorf("Storage '%v' of '%v' type was badly configured", storage.ID(), storage.Type())
	}

	//API Connectors sync
	if overriddenDataSchema != nil {
		flatDataPerTable, err := processor.ProcessPulledEvents(overriddenDataSchema.TableName, objects)
		if err != nil {
			return nil, err
		}

		if len(overriddenDataSchema.Fields) > 0 {
			// enrich overridden schema types
			flatDataPerTable[overriddenDataSchema.TableName].BatchHeader.Fields.OverrideTypes(overriddenDataSchema.Fields)
		}

		return flatDataPerTable, nil
	}

	//Update call with single object or bulk uploading
	flatDataPerTable, _, failedEvents, _, err := processor.ProcessEvents(fileName, objects, map[string]bool{}, needCopyEvent)
	if err != nil {
		return nil, err
	}

	if !failedEvents.IsEmpty() {
		for _, e := range failedEvents.Events {
			err = multierror.Append(err, errors.New(e.Error))
		}
		return nil, err
	}

	return flatDataPerTable, nil
}

func writeEventsToCache(storage Storage, eventsCache *caching.EventsCache, table *adapters.Table, fdata *schema.ProcessedFile, storeErr error) {
	rawEvents := fdata.GetOriginalRawEvents()
	for i, object := range fdata.GetPayload() {
		rawEvent := rawEvents[i]
		if storeErr != nil {
			eventsCache.Error(storage.IsCachingDisabled(), storage.ID(), rawEvent, storeErr.Error())
		} else {
			eventsCache.Succeed(&adapters.EventContext{
				CacheDisabled:           storage.IsCachingDisabled(),
				DestinationID:           storage.ID(),
				SerializedOriginalEvent: rawEvent,
				EventID:                 storage.GetUniqueIDField().Extract(object),
				ProcessedEvent:          object,
				Table:                   table,
			})
		}
	}
}
