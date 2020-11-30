package storages

import (
	"context"
	"fmt"
	"github.com/hashicorp/go-multierror"
	"github.com/jitsucom/eventnative/adapters"
	"github.com/jitsucom/eventnative/caching"
	"github.com/jitsucom/eventnative/counters"
	"github.com/jitsucom/eventnative/events"
	"github.com/jitsucom/eventnative/parsers"
	"github.com/jitsucom/eventnative/logging"
	"github.com/jitsucom/eventnative/schema"
	"github.com/jitsucom/eventnative/typing"
)

//Store files to Postgres in two modes:
//batch: (1 file = 1 transaction)
//stream: (1 object = 1 transaction)
type Postgres struct {
	name            string
	adapter         *adapters.Postgres
	tableHelper     *TableHelper
	schemaProcessor *schema.Processor
	streamingWorker *StreamingWorker
	fallbackLogger  *events.AsyncLogger
	eventsCache     *caching.EventsCache
	breakOnError    bool
}

func NewPostgres(ctx context.Context, config *adapters.DataSourceConfig, processor *schema.Processor, eventQueue *events.PersistentQueue,
	storageName string, breakOnError, streamMode bool, monitorKeeper MonitorKeeper, fallbackLoggerFactoryMethod func() *events.AsyncLogger,
	queryLogger *logging.QueryLogger, eventsCache *caching.EventsCache) (*Postgres, error) {

	adapter, err := adapters.NewPostgres(ctx, config, queryLogger)
	if err != nil {
		return nil, err
	}

	//create db schema if doesn't exist
	err = adapter.CreateDbSchema(config.Schema)
	if err != nil {
		adapter.Close()
		return nil, err
	}

	tableHelper := NewTableHelper(adapter, monitorKeeper, PostgresType)

	p := &Postgres{
		name:            storageName,
		adapter:         adapter,
		tableHelper:     tableHelper,
		schemaProcessor: processor,
		fallbackLogger:  fallbackLoggerFactoryMethod(),
		eventsCache:     eventsCache,
		breakOnError:    breakOnError,
	}

	if streamMode {
		p.streamingWorker = newStreamingWorker(eventQueue, processor, p, eventsCache)
		p.streamingWorker.start()
	}

	return p, nil
}

//Store call StoreWithParseFunc with parsers.ParseJson func
func (p *Postgres) Store(fileName string, payload []byte) (int, error) {
	return p.StoreWithParseFunc(fileName, payload, parsers.ParseJson)
}

//StoreWithParseFunc file payload to Postgres with processing
//return rows count and err if can't store
//or rows count and nil if stored
func (p *Postgres) StoreWithParseFunc(fileName string, payload []byte, parseFunc func([]byte) (map[string]interface{}, error)) (int, error) {
	flatData, failedEvents, err := p.schemaProcessor.ProcessFilePayload(fileName, payload, p.breakOnError, parseFunc)
	if err != nil {
		return linesCount(payload), err
	}

	rowsCount, err := p.store(flatData)

	//send failed events to fallback only if other events have been inserted ok
	if err == nil {
		p.Fallback(failedEvents...)
		counters.ErrorEvents(p.Name(), len(failedEvents))
		for _, failedFact := range failedEvents {
			p.eventsCache.Error(p.Name(), failedFact.EventId, failedFact.Error)
		}
	}

	return rowsCount, err
}

//Fallback log event with error to fallback logger
func (p *Postgres) Fallback(failedFacts ...*events.FailedFact) {
	for _, failedFact := range failedFacts {
		p.fallbackLogger.ConsumeAny(failedFact)
	}
}

//SyncStore store chunk payload to Postgres with processing
//return rows count and err if can't store
//or rows count and nil if stored
func (p *Postgres) SyncStore(objects []map[string]interface{}) (int, error) {
	flatData, err := p.schemaProcessor.ProcessObjects(objects)
	if err != nil {
		return len(objects), err
	}

	return p.store(flatData)
}

//Insert fact in Postgres
func (p *Postgres) Insert(dataSchema *schema.Table, fact events.Fact) (err error) {
	dbSchema, err := p.tableHelper.EnsureTable(p.Name(), dataSchema)
	if err != nil {
		return err
	}

	if err := p.schemaProcessor.ApplyDBTypingToObject(dbSchema, fact); err != nil {
		return err
	}

	return p.adapter.Insert(dataSchema, fact)
}

func (p *Postgres) ColumnTypesMapping() map[typing.DataType]string {
	return adapters.SchemaToPostgres
}

func (p *Postgres) store(flatData map[string]*schema.ProcessedFile) (rowsCount int, err error) {
	for _, fdata := range flatData {
		rowsCount += fdata.GetPayloadLen()
	}

	//events cache
	defer func() {
		for _, fdata := range flatData {
			for _, object := range fdata.GetPayload() {
				if err != nil {
					p.eventsCache.Error(p.Name(), events.ExtractEventId(object), err.Error())
				} else {
					p.eventsCache.Succeed(p.Name(), events.ExtractEventId(object), object, fdata.DataSchema, p.ColumnTypesMapping())
				}
			}
		}
	}()

	//process db tables & schema
	for _, fdata := range flatData {
		dbSchema, err := p.tableHelper.EnsureTable(p.Name(), fdata.DataSchema)
		if err != nil {
			return rowsCount, err
		}

		if err := p.schemaProcessor.ApplyDBTyping(dbSchema, fdata); err != nil {
			return rowsCount, err
		}
	}

	//insert all data in one transaction
	tx, err := p.adapter.OpenTx()
	if err != nil {
		return rowsCount, fmt.Errorf("Error opening postgres transaction: %v", err)
	}

	for _, fdata := range flatData {
		for _, object := range fdata.GetPayload() {
			if err := p.adapter.InsertInTransaction(tx, fdata.DataSchema, object); err != nil {
				tx.Rollback()
				return rowsCount, err
			}
		}
	}

	return rowsCount, tx.DirectCommit()
}

//Close adapters.Postgres
func (p *Postgres) Close() (multiErr error) {
	if err := p.adapter.Close(); err != nil {
		multiErr = multierror.Append(multiErr, fmt.Errorf("[%s] Error closing postgres datasource: %v", p.Name(), err))
	}

	if p.streamingWorker != nil {
		p.streamingWorker.Close()
	}

	if err := p.fallbackLogger.Close(); err != nil {
		multiErr = multierror.Append(multiErr, fmt.Errorf("[%s] Error closing fallback logger: %v", p.Name(), err))
	}

	return
}

func (p *Postgres) Name() string {
	return p.name
}

func (p *Postgres) Type() string {
	return PostgresType
}
