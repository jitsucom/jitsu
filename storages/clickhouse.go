package storages

import (
	"context"
	"fmt"
	"github.com/hashicorp/go-multierror"
	"github.com/ksensehq/eventnative/adapters"
	"github.com/ksensehq/eventnative/schema"
	"log"
	"math/rand"
)

//Store files to ClickHouse in batch mode (1 log file = 1 transaction)
//Keeping tables schema state inmemory and update it according to incoming new data
//note: Assume that after any outer changes in db we need to recreate this structure
//for keeping actual db tables schema state
type ClickHouse struct {
	name            string
	sourceDir       string
	adapters        []*adapters.ClickHouse
	schemaProcessor *schema.Processor
	tables          map[string]*schema.Table
	breakOnError    bool
}

func NewClickHouse(ctx context.Context, name, sourceDir string, config *adapters.ClickHouseConfig, processor *schema.Processor, breakOnError bool) (*ClickHouse, error) {
	tableStatementFactory, err := adapters.NewTableStatementFactory(config)
	if err != nil {
		return nil, err
	}

	//put default values and values from config
	nonNullFields := map[string]bool{"eventn_ctx_event_id": true, "_timestamp": true}
	if config.Engine != nil {
		for _, fieldName := range config.Engine.NonNullFields {
			nonNullFields[fieldName] = true
		}
	}

	var chAdapters []*adapters.ClickHouse
	for _, dsn := range config.Dsns {
		adapter, err := adapters.NewClickHouse(ctx, dsn, config.Database, config.Cluster, config.Tls, tableStatementFactory, nonNullFields)
		if err != nil {
			//close all previous created adapters
			for _, toClose := range chAdapters {
				toClose.Close()
			}
			return nil, err
		}

		chAdapters = append(chAdapters, adapter)
	}

	ch := &ClickHouse{
		name:            name,
		sourceDir:       sourceDir,
		adapters:        chAdapters,
		schemaProcessor: processor,
		tables:          map[string]*schema.Table{},
		breakOnError:    breakOnError,
	}

	fr := &FileReader{dir: sourceDir, storage: ch}
	fr.start()

	return ch, nil
}

func (ch *ClickHouse) Name() string {
	return ch.name
}

func (ch *ClickHouse) Type() string {
	return "ClickHouse"
}

func (ch *ClickHouse) SourceDir() string {
	return ch.sourceDir
}

//Store file payload to ClickHouse with processing
func (ch *ClickHouse) Store(fileName string, payload []byte) error {
	flatData, err := ch.schemaProcessor.ProcessFilePayload(fileName, payload, ch.breakOnError)
	if err != nil {
		return err
	}

	adapter := ch.getAdapter()
	//process db tables & schema
	for _, fdata := range flatData {
		dbTableSchema, ok := ch.tables[fdata.DataSchema.Name]
		if !ok {
			//Get or Create Table
			dbTableSchema, err = adapter.GetTableSchema(fdata.DataSchema.Name)
			if err != nil {
				return fmt.Errorf("Error getting table %s schema from clickhouse: %v", fdata.DataSchema.Name, err)
			}
			if !dbTableSchema.Exists() {
				if err := adapter.CreateTable(fdata.DataSchema); err != nil {
					return fmt.Errorf("Error creating table %s in clickhouse: %v", fdata.DataSchema.Name, err)
				}
				dbTableSchema = fdata.DataSchema
			}
			//Save
			ch.tables[dbTableSchema.Name] = dbTableSchema
		}

		schemaDiff := dbTableSchema.Diff(fdata.DataSchema)
		//Patch
		if schemaDiff.Exists() {
			if err := adapter.PatchTableSchema(schemaDiff); err != nil {
				return fmt.Errorf("Error patching table schema %s in clickhouse: %v", schemaDiff.Name, err)
			}
			//Save
			for k, v := range schemaDiff.Columns {
				dbTableSchema.Columns[k] = v
			}
		}
	}

	//insert all data in one transaction
	tx, err := adapter.OpenTx()
	if err != nil {
		return fmt.Errorf("Error opening clickhouse transaction: %v", err)
	}

	for _, fdata := range flatData {
		for _, object := range fdata.Payload {
			if err := adapter.InsertInTransaction(tx, fdata.DataSchema, object); err != nil {
				if ch.breakOnError {
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

//Close adapters.ClickHouse
func (ch *ClickHouse) Close() (multiErr error) {
	for i, adapter := range ch.adapters {
		if err := adapter.Close(); err != nil {
			multiErr = multierror.Append(multiErr, fmt.Errorf("Error closing clickhouse datasource[%d]: %v", i, err))
		}
	}

	return multiErr
}

func (ch *ClickHouse) getAdapter() *adapters.ClickHouse {
	return ch.adapters[rand.Intn(len(ch.adapters))]
}
