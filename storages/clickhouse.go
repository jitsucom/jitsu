package storages

import (
	"context"
	"fmt"
	"github.com/hashicorp/go-multierror"
	"github.com/jitsucom/eventnative/adapters"
	"github.com/jitsucom/eventnative/caching"
	"github.com/jitsucom/eventnative/counters"
	"github.com/jitsucom/eventnative/events"
	"github.com/jitsucom/eventnative/logging"
	"github.com/jitsucom/eventnative/parsers"
	"github.com/jitsucom/eventnative/schema"
	"github.com/jitsucom/eventnative/typing"
	"math/rand"
)

//Store files to ClickHouse in two modes:
//batch: (1 file = 1 transaction)
//stream: (1 object = 1 transaction)
type ClickHouse struct {
	name            string
	adapters        []*adapters.ClickHouse
	tableHelpers    []*TableHelper
	schemaProcessor *schema.Processor
	streamingWorker *StreamingWorker
	fallbackLogger  *events.AsyncLogger
	eventsCache     *caching.EventsCache
	breakOnError    bool
}

func NewClickHouse(ctx context.Context, name string, eventQueue *events.PersistentQueue, config *adapters.ClickHouseConfig,
	processor *schema.Processor, breakOnError, streamMode bool, monitorKeeper MonitorKeeper,
	fallbackLoggerFactoryMethod func() *events.AsyncLogger, queryLogger *logging.QueryLogger, eventsCache *caching.EventsCache) (*ClickHouse, error) {
	tableStatementFactory, err := adapters.NewTableStatementFactory(config)
	if err != nil {
		return nil, err
	}

	nullableFields := map[string]bool{}
	if config.Engine != nil {
		for _, fieldName := range config.Engine.NullableFields {
			nullableFields[fieldName] = true
		}
	}

	var chAdapters []*adapters.ClickHouse
	var tableHelpers []*TableHelper
	for _, dsn := range config.Dsns {
		adapter, err := adapters.NewClickHouse(ctx, dsn, config.Database, config.Cluster, config.Tls,
			tableStatementFactory, nullableFields, queryLogger)
		if err != nil {
			//close all previous created adapters
			for _, toClose := range chAdapters {
				toClose.Close()
			}
			return nil, err
		}

		chAdapters = append(chAdapters, adapter)
		tableHelpers = append(tableHelpers, NewTableHelper(adapter, monitorKeeper, ClickHouseType))
	}

	ch := &ClickHouse{
		name:            name,
		adapters:        chAdapters,
		tableHelpers:    tableHelpers,
		schemaProcessor: processor,
		eventsCache:     eventsCache,
		breakOnError:    breakOnError,
	}

	adapter, _ := ch.getAdapters()
	err = adapter.CreateDB(config.Database)
	if err != nil {
		//close all previous created adapters
		for _, toClose := range chAdapters {
			toClose.Close()
		}
		return nil, err
	}

	ch.fallbackLogger = fallbackLoggerFactoryMethod()

	if streamMode {
		ch.streamingWorker = newStreamingWorker(eventQueue, processor, ch, eventsCache)
		ch.streamingWorker.start()
	}

	return ch, nil
}

func (ch *ClickHouse) Name() string {
	return ch.name
}

func (ch *ClickHouse) Type() string {
	return ClickHouseType
}

//Insert fact in ClickHouse
func (ch *ClickHouse) Insert(dataSchema *schema.Table, fact events.Fact) (err error) {
	adapter, tableHelper := ch.getAdapters()

	dbSchema, err := tableHelper.EnsureTable(ch.Name(), dataSchema)
	if err != nil {
		return err
	}

	if err := ch.schemaProcessor.ApplyDBTypingToObject(dbSchema, fact); err != nil {
		return err
	}

	return adapter.Insert(dataSchema, fact)
}

//Store call StoreWithParseFunc with parsers.ParseJson func
func (ch *ClickHouse) Store(fileName string, payload []byte) (int, error) {
	return ch.StoreWithParseFunc(fileName, payload, parsers.ParseJson)
}

//StoreWithParseFunc store file payload to ClickHouse with processing
//return rows count and err if can't store
//or rows count and nil if stored
func (ch *ClickHouse) StoreWithParseFunc(fileName string, payload []byte, parseFunc func([]byte) (map[string]interface{}, error)) (int, error) {
	flatData, failedEvents, err := ch.schemaProcessor.ProcessFilePayload(fileName, payload, ch.breakOnError, parseFunc)
	if err != nil {
		return linesCount(payload), err
	}

	rowsCount, err := ch.store(flatData)

	//send failed events to fallback only if other events have been inserted ok
	if err == nil {
		ch.Fallback(failedEvents...)
		counters.ErrorEvents(ch.Name(), len(failedEvents))
		for _, failedFact := range failedEvents {
			ch.eventsCache.Error(ch.Name(), failedFact.EventId, failedFact.Error)
		}
	}

	return rowsCount, err
}

//SyncStore store chunk payload to ClickHouse with processing
//return rows count and err if can't store
//or rows count and nil if stored
func (ch *ClickHouse) SyncStore(objects []map[string]interface{}) (int, error) {
	flatData, err := ch.schemaProcessor.ProcessObjects(objects)
	if err != nil {
		return len(objects), err
	}

	return ch.store(flatData)
}

func (ch *ClickHouse) ColumnTypesMapping() map[typing.DataType]string {
	return adapters.SchemaToClickhouse
}

//Fallback log event with error to fallback logger
func (ch *ClickHouse) Fallback(failedFacts ...*events.FailedFact) {
	for _, failedFact := range failedFacts {
		ch.fallbackLogger.ConsumeAny(failedFact)
	}
}

func (ch *ClickHouse) store(flatData map[string]*schema.ProcessedFile) (rowsCount int, err error) {
	for _, fdata := range flatData {
		rowsCount += fdata.GetPayloadLen()
	}

	//events cache
	defer func() {
		for _, fdata := range flatData {
			for _, object := range fdata.GetPayload() {
				if err != nil {
					ch.eventsCache.Error(ch.Name(), events.ExtractEventId(object), err.Error())
				} else {
					ch.eventsCache.Succeed(ch.Name(), events.ExtractEventId(object), object, fdata.DataSchema, ch.ColumnTypesMapping())
				}
			}
		}
	}()

	adapter, tableHelper := ch.getAdapters()
	//process db tables & schema
	for _, fdata := range flatData {
		dbSchema, err := tableHelper.EnsureTable(ch.Name(), fdata.DataSchema)
		if err != nil {
			return rowsCount, err
		}

		if err := ch.schemaProcessor.ApplyDBTyping(dbSchema, fdata); err != nil {
			return rowsCount, err
		}
	}

	tx, err := adapter.OpenTx()
	if err != nil {
		return rowsCount, fmt.Errorf("Error opening clickhouse transaction: %v", err)
	}

	for _, fdata := range flatData {
		for _, object := range fdata.GetPayload() {
			if err := adapter.InsertInTransaction(tx, fdata.DataSchema, object); err != nil {
				return rowsCount, err
			}
		}
	}

	return rowsCount, tx.DirectCommit()
}

//Close adapters.ClickHouse
func (ch *ClickHouse) Close() (multiErr error) {
	for i, adapter := range ch.adapters {
		if err := adapter.Close(); err != nil {
			multiErr = multierror.Append(multiErr, fmt.Errorf("[%s] Error closing clickhouse datasource[%d]: %v", ch.Name(), i, err))
		}
	}

	if ch.streamingWorker != nil {
		ch.streamingWorker.Close()
	}

	if err := ch.fallbackLogger.Close(); err != nil {
		multiErr = multierror.Append(multiErr, fmt.Errorf("[%s] Error closing fallback logger: %v", ch.Name(), err))
	}

	return
}

//assume that adapters quantity == tableHelpers quantity
func (ch *ClickHouse) getAdapters() (*adapters.ClickHouse, *TableHelper) {
	num := rand.Intn(len(ch.adapters))
	return ch.adapters[num], ch.tableHelpers[num]
}
