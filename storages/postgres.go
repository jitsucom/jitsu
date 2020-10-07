package storages

import (
	"context"
	"fmt"
	"github.com/ksensehq/eventnative/adapters"
	"github.com/ksensehq/eventnative/events"
	"github.com/ksensehq/eventnative/logging"
	"github.com/ksensehq/eventnative/schema"
)

//Store files to Postgres in two modes:
//batch: (1 file = 1 transaction)
//stream: (1 object = 1 transaction)
type Postgres struct {
	name            string
	adapter         *adapters.Postgres
	tableHelper     *TableHelper
	schemaProcessor *schema.Processor
	breakOnError    bool
}

func NewPostgres(ctx context.Context, config *adapters.DataSourceConfig, processor *schema.Processor, eventQueue *events.PersistentQueue,
	storageName string, breakOnError, streamMode bool, monitorKeeper MonitorKeeper) (*Postgres, error) {

	adapter, err := adapters.NewPostgres(ctx, config)
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
		newStreamingWorker(eventQueue, processor, p).start()
	}

	return p, nil
}

//Store file payload to Postgres with processing
func (p *Postgres) Store(fileName string, payload []byte) error {
	flatData, err := p.schemaProcessor.ProcessFilePayload(fileName, payload, p.breakOnError)
	if err != nil {
		return err
	}

	//process db tables & schema
	for _, fdata := range flatData {
		dbSchema, err := p.tableHelper.EnsureTable(p.Name(), fdata.DataSchema)
		if err != nil {
			return err
		}

		if err := p.schemaProcessor.ApplyDBTyping(dbSchema, fdata); err != nil {
			return err
		}
	}

	//insert all data in one transaction
	tx, err := p.adapter.OpenTx()
	if err != nil {
		return fmt.Errorf("Error opening postgres transaction: %v", err)
	}

	for _, fdata := range flatData {
		for _, object := range fdata.GetPayload() {
			if err := p.adapter.InsertInTransaction(tx, fdata.DataSchema, object); err != nil {
				if p.breakOnError {
					tx.Rollback()
					return err
				} else {
					logging.Warnf("[%s] Unable to insert object %v reason: %v. This line will be skipped", p.Name(), object, err)
				}
			}
		}
	}

	return tx.DirectCommit()
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

//Close adapters.Postgres
func (p *Postgres) Close() error {
	if err := p.adapter.Close(); err != nil {
		return fmt.Errorf("[%s] Error closing postgres datasource: %v", p.Name(), err)
	}

	return nil
}

func (p *Postgres) Name() string {
	return p.name
}

func (p *Postgres) Type() string {
	return PostgresType
}
