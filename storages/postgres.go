package storages

import (
	"context"
	"fmt"
	"github.com/hashicorp/go-multierror"
	"github.com/joncrlsn/dque"
	"github.com/ksensehq/eventnative/adapters"
	"github.com/ksensehq/eventnative/appconfig"
	"github.com/ksensehq/eventnative/appstatus"
	"github.com/ksensehq/eventnative/events"
	"github.com/ksensehq/eventnative/schema"
	"log"
)

const eventsPerPersistedFile = 2000

//Consuming event facts, put them to https://github.com/joncrlsn/dque
//Dequeuing and store events to Postgres in streaming mode
//Keeping tables schema state inmemory and update it according to incoming new data
//note: Assume that after any outer changes in db we need to recreate this structure
//for keeping actual db tables schema state
type Postgres struct {
	adapter         *adapters.Postgres
	schemaProcessor *schema.Processor
	tables          map[string]*schema.Table
	eventQueue      *dque.DQue
}

// EventFactBuilder creates and returns a new events.Fact.
// This is used when we load a segment of the queue from disk.
func EventFactBuilder() interface{} {
	return events.Fact{}
}

func NewPostgres(ctx context.Context, config *adapters.DataSourceConfig, processor *schema.Processor,
	fallbackDir, storageName string) (*Postgres, error) {
	adapter, err := adapters.NewPostgres(ctx, config)
	if err != nil {
		return nil, err
	}

	//create db schema if doesn't exist
	err = adapter.CreateDbSchema(config.Schema)
	if err != nil {
		return nil, err
	}

	queueName := fmt.Sprintf("%s-%s", appconfig.Instance.ServerName, storageName)
	queue, err := dque.Open(queueName, fallbackDir, eventsPerPersistedFile, EventFactBuilder)
	if err != nil {
		queue, err = dque.New(queueName, fallbackDir, eventsPerPersistedFile, EventFactBuilder)
		if err != nil {
			return nil, fmt.Errorf("Error creating event queue for postgres: %v", err)
		}
	}

	p := &Postgres{
		adapter:         adapter,
		schemaProcessor: processor,
		tables:          map[string]*schema.Table{},
		eventQueue:      queue,
	}
	p.start()

	return p, nil
}

func (p *Postgres) Consume(fact events.Fact) {
	if err := p.eventQueue.Enqueue(fact); err != nil {
		log.Println("Error putting event fact to the Postgres queue:", err)
	}
}

//Run goroutine to:
//1. read from queue
//2. insert in postgres
//3. if error => enqueue one more time
func (p *Postgres) start() {
	go func() {
		for {
			if appstatus.Instance.Idle {
				break
			}
			iface, err := p.eventQueue.DequeueBlock()
			if err != nil {
				log.Println("Error reading event fact from postgres queue", err)
				continue
			}

			fact, ok := iface.(events.Fact)
			if !ok {
				log.Println("Warn: Dequeued object is not an events.Fact instance")
				continue
			}

			dataSchema, flattenObject, err := p.schemaProcessor.ProcessFact(fact)
			if err != nil {
				log.Printf("Unable to process object %v: %v", fact, err)
				p.enqueue(fact)
				continue
			}

			//don't process empty object
			if !dataSchema.Exists() {
				continue
			}

			if err := p.insert(dataSchema, flattenObject); err != nil {
				log.Printf("Error inserting to postgres table [%s]: %v", dataSchema.Name, err)
				p.enqueue(fact)
				continue
			}
		}
	}()
}

//insert fact in Postgres
func (p *Postgres) insert(dataSchema *schema.Table, fact events.Fact) error {
	dbTableSchema, ok := p.tables[dataSchema.Name]
	if !ok {
		//Get or Create Table
		dbTableSchema, err := p.adapter.GetTableSchema(dataSchema.Name)
		if err != nil {
			return fmt.Errorf("Error getting table %s schema from postgres: %v", dataSchema.Name, err)
		}
		if !dbTableSchema.Exists() {
			if err := p.adapter.CreateTable(dataSchema); err != nil {
				return fmt.Errorf("Error creating table %s in postgres: %v", dataSchema.Name, err)
			}
			dbTableSchema = dataSchema
		}
		//Save
		p.tables[dbTableSchema.Name] = dbTableSchema
	}

	schemaDiff := dbTableSchema.Diff(dataSchema)
	//Patch
	if schemaDiff.Exists() {
		if err := p.adapter.PatchTableSchema(schemaDiff); err != nil {
			return fmt.Errorf("Error creating table %s in postgres: %v", schemaDiff.Name, err)
		}
		//Save
		for k, v := range schemaDiff.Columns {
			dbTableSchema.Columns[k] = v
		}
	}

	return p.adapter.Insert(dbTableSchema, fact)
}

func (p *Postgres) enqueue(fact events.Fact) {
	if err := p.eventQueue.Enqueue(fact); err != nil {
		log.Printf("Warn: unable to enqueue object %v reason: %v. This object will be skipped", fact, err)
	}
}

func (p *Postgres) Close() (multiErr error) {
	if err := p.adapter.Close(); err != nil {
		multiErr = multierror.Append(multiErr, fmt.Errorf("Error closing postgres datasource: %v", err))
	}
	if err := p.eventQueue.Close(); err != nil {
		multiErr = multierror.Append(multiErr, fmt.Errorf("Error closing postgres event queue: %v", err))
	}

	return
}
