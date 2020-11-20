package storages

import (
	"context"
	"fmt"
	"github.com/jitsucom/eventnative/adapters"
	"github.com/jitsucom/eventnative/events"
	"github.com/jitsucom/eventnative/logging"
	"github.com/jitsucom/eventnative/schema"
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
	breakOnError    bool
}

func NewPostgres(ctx context.Context, config *adapters.DataSourceConfig, processor *schema.Processor,
	eventQueue *events.PersistentQueue, storageName string, breakOnError, streamMode bool, monitorKeeper MonitorKeeper,
	queryLogger *logging.QueryLogger) (*Postgres, error) {

	adapter, err := adapters.NewPostgres(ctx, config, queryLogger, storageName)
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
		breakOnError:    breakOnError,
	}

	if streamMode {
		p.streamingWorker = newStreamingWorker(eventQueue, processor, p)
		p.streamingWorker.start()
	}

	return p, nil
}

//Store file payload to Postgres with processing
//return rows count and err if can't store
//or rows count and nil if stored
func (p *Postgres) Store(fileName string, payload []byte) (int, error) {
	flatData, err := p.schemaProcessor.ProcessFilePayload(fileName, payload, p.breakOnError)
	if err != nil {
		return linesCount(payload), err
	}

	return p.store(flatData)
}

//SyncStore store chunk payload to Postgres with processing
//return rows count and err if can't store
//or rows count and nil if stored
func (p *Postgres) SyncStore(objects []map[string]interface{}) (int, error) {
	flatData, err := p.schemaProcessor.ProcessObjects(objects, p.breakOnError)
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

func (p *Postgres) store(flatData map[string]*schema.ProcessedFile) (int, error) {
	var rowsCount int
	for _, fdata := range flatData {
		rowsCount += fdata.GetPayloadLen()
	}

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
func (p *Postgres) Close() error {
	if err := p.adapter.Close(); err != nil {
		return fmt.Errorf("[%s] Error closing postgres datasource: %v", p.Name(), err)
	}

	if p.streamingWorker != nil {
		p.streamingWorker.Close()
	}
	return nil
}

func (p *Postgres) Name() string {
	return p.name
}

func (p *Postgres) Type() string {
	return PostgresType
}
