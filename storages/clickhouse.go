package storages

import (
	"context"
	"fmt"
	"github.com/ksensehq/eventnative/adapters"
	"github.com/ksensehq/eventnative/schema"
	"log"
)

//Store files to ClickHouse in batch mode (1 log file = 1 transaction)
//Keeping tables schema state inmemory and update it according to incoming new data
//note: Assume that after any outer changes in db we need to recreate this structure
//for keeping actual db tables schema state
type ClickHouse struct {
	adapter         *adapters.ClickHouse
	schemaProcessor *schema.Processor
	tables          map[string]*schema.Table
	breakOnError    bool
}

func NewClickHouse(ctx context.Context, config *adapters.ClickHouseConfig, processor *schema.Processor, breakOnError bool) (*ClickHouse, error) {
	adapter, err := adapters.NewClickHouse(ctx, config.Dsn, config.Database, config.Tls)
	if err != nil {
		return nil, err
	}

	return &ClickHouse{
		adapter:         adapter,
		schemaProcessor: processor,
		tables:          map[string]*schema.Table{},
		breakOnError:    breakOnError,
	}, nil
}

func (ch *ClickHouse) Name() string {
	return "ClickHouse"
}

//Store file payload to ClickHouse with processing
func (ch *ClickHouse) Store(fileName string, payload []byte) error {
	flatData, err := ch.schemaProcessor.ProcessFilePayload(fileName, payload, ch.breakOnError)
	if err != nil {
		return err
	}

	//process db tables & schema
	for _, fdata := range flatData {
		dbTableSchema, ok := ch.tables[fdata.DataSchema.Name]
		if !ok {
			//Get or Create Table
			dbTableSchema, err = ch.adapter.GetTableSchema(fdata.DataSchema.Name)
			if err != nil {
				return fmt.Errorf("Error getting table %s schema from clickhouse: %v", fdata.DataSchema.Name, err)
			}
			if !dbTableSchema.Exists() {
				if err := ch.adapter.CreateTable(fdata.DataSchema); err != nil {
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
			if err := ch.adapter.PatchTableSchema(schemaDiff); err != nil {
				return fmt.Errorf("Error patching table schema %s in clickhouse: %v", schemaDiff.Name, err)
			}
			//Save
			for k, v := range schemaDiff.Columns {
				dbTableSchema.Columns[k] = v
			}
		}
	}

	//insert all data in one transaction
	tx, err := ch.adapter.OpenTx()
	if err != nil {
		return fmt.Errorf("Error opening clickhouse transaction: %v", err)
	}

	for _, fdata := range flatData {
		for _, object := range fdata.Payload {
			if err := ch.adapter.InsertInTransaction(tx, fdata.DataSchema, object); err != nil {
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
func (ch *ClickHouse) Close() error {
	if err := ch.adapter.Close(); err != nil {
		return fmt.Errorf("Error closing clickhouse datasource: %v", err)
	}

	return nil
}
