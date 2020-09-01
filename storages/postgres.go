package storages

import (
	"context"
	"fmt"
	"github.com/hashicorp/go-multierror"
	"github.com/ksensehq/eventnative/adapters"
	"github.com/ksensehq/eventnative/appconfig"
	"github.com/ksensehq/eventnative/appstatus"
	"github.com/ksensehq/eventnative/events"
	"github.com/ksensehq/eventnative/schema"
	"log"
)

const postgresStorageType = "Postgres"

//Store files to Postgres in two modes:
//batch: (1 file = 1 transaction)
//streaming: (1 object = 1 transaction)
type Postgres struct {
	name            string
	adapter         *adapters.Postgres
	tableHelper     *TableHelper
	schemaProcessor *schema.Processor
	eventQueue      *events.PersistentQueue
	breakOnError    bool
}

func NewPostgres(ctx context.Context, config *adapters.DataSourceConfig, processor *schema.Processor,
	fallbackDir, storageName string, breakOnError, streamingMode bool) (*Postgres, error) {
	var eventQueue *events.PersistentQueue
	if streamingMode {
		var err error
		queueName := fmt.Sprintf("%s-%s", appconfig.Instance.ServerName, storageName)
		eventQueue, err = events.NewPersistentQueue(queueName, fallbackDir)
		if err != nil {
			return nil, err
		}
	}

	adapter, err := adapters.NewPostgres(ctx, config)
	if err != nil {
		return nil, err
	}

	//create db schema if doesn't exist
	err = adapter.CreateDbSchema(config.Schema)
	if err != nil {
		return nil, err
	}

	monitorKeeper := NewMonitorKeeper()
	tableHelper := NewTableHelper(adapter, monitorKeeper, postgresStorageType)

	p := &Postgres{
		name:            storageName,
		adapter:         adapter,
		tableHelper:     tableHelper,
		schemaProcessor: processor,
		eventQueue:      eventQueue,
		breakOnError:    breakOnError,
	}

	if streamingMode {
		p.startStreamingConsumer()
	}

	return p, nil
}

//Consume events.Fact and enqueue it
func (p *Postgres) Consume(fact events.Fact) {
	if err := p.eventQueue.Enqueue(fact); err != nil {
		logSkippedEvent(fact, err)
	}
}

//Run goroutine to:
//1. read from queue
//2. insert in Postgres
func (p *Postgres) startStreamingConsumer() {
	go func() {
		for {
			if appstatus.Instance.Idle {
				break
			}
			fact, err := p.eventQueue.DequeueBlock()
			if err != nil {
				log.Println("Error reading event fact from postgres queue", err)
				continue
			}

			dataSchema, flattenObject, err := p.schemaProcessor.ProcessFact(fact)
			if err != nil {
				log.Printf("Unable to process object %v: %v", fact, err)
				continue
			}

			//don't process empty object
			if !dataSchema.Exists() {
				continue
			}

			if err := p.insert(dataSchema, flattenObject); err != nil {
				log.Printf("Error inserting to postgres table [%s]: %v", dataSchema.Name, err)
				continue
			}
		}
	}()
}

//Store file payload to Postgres with processing
func (p *Postgres) Store(fileName string, payload []byte) error {
	flatData, err := p.schemaProcessor.ProcessFilePayload(fileName, payload, p.breakOnError)
	if err != nil {
		return err
	}

	//process db tables & schema
	for _, fdata := range flatData {
		dbSchema, err := p.tableHelper.EnsureTable(fdata.DataSchema)
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
					log.Printf("Warn: unable to insert object %v reason: %v. This line will be skipped", object, err)
				}
			}
		}
	}

	return tx.DirectCommit()
}

//insert fact in Postgres
func (p *Postgres) insert(dataSchema *schema.Table, fact events.Fact) (err error) {
	dbSchema, err := p.tableHelper.EnsureTable(dataSchema)
	if err != nil {
		return err
	}

	if err := p.schemaProcessor.ApplyDBTypingToObject(dbSchema, fact); err != nil {
		return err
	}

	return p.adapter.Insert(dataSchema, fact)
}

//Close adapters.Postgres and queue
func (p *Postgres) Close() (multiErr error) {
	if err := p.adapter.Close(); err != nil {
		multiErr = multierror.Append(multiErr, fmt.Errorf("Error closing postgres datasource: %v", err))
	}

	if p.eventQueue != nil {
		if err := p.eventQueue.Close(); err != nil {
			multiErr = multierror.Append(multiErr, fmt.Errorf("Error closing postgres event queue: %v", err))
		}
	}

	return
}

func (p *Postgres) Name() string {
	return p.name
}

func (p *Postgres) Type() string {
	return postgresStorageType
}

func logSkippedEvent(fact events.Fact, err error) {
	log.Printf("Warn: unable to enqueue object %v reason: %v. This object will be skipped", fact, err)
}
