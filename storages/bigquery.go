package storages

import (
	"context"
	"fmt"
	"github.com/hashicorp/go-multierror"
	"github.com/ksensehq/eventnative/adapters"
	"github.com/ksensehq/eventnative/appstatus"
	"github.com/ksensehq/eventnative/schema"
	"log"
	"strings"
	"time"
)

type BigQuery struct {
	gcsAdapter      *adapters.GoogleCloudStorage
	bqAdapter       *adapters.BigQuery
	schemaProcessor *schema.Processor
	tables          map[string]*schema.Table
	breakOnError    bool
}

func NewBigQuery(ctx context.Context, config *adapters.GoogleConfig, processor *schema.Processor, breakOnError bool) (*BigQuery, error) {
	gcsAdapter, err := adapters.NewGoogleCloudStorage(ctx, config)
	if err != nil {
		return nil, err
	}

	bigQueryAdapter, err := adapters.NewBigQuery(ctx, config)
	if err != nil {
		return nil, err
	}

	//create dataset if doesn't exist
	err = bigQueryAdapter.CreateDataset(config.Dataset)
	if err != nil {
		return nil, err
	}

	bq := &BigQuery{
		gcsAdapter:      gcsAdapter,
		bqAdapter:       bigQueryAdapter,
		schemaProcessor: processor,
		tables:          map[string]*schema.Table{},
		breakOnError:    breakOnError,
	}
	bq.start()

	return bq, nil
}

func (bq *BigQuery) start() {
	go func() {
		for {
			if appstatus.Instance.Idle {
				break
			}
			//TODO configurable
			time.Sleep(1 * time.Minute)

			//TODO if we want to accumulate all users in one bucket -> create different folders
			filesKeys, err := bq.gcsAdapter.ListBucket()
			if err != nil {
				log.Println("Error reading files from google cloud storage", err)
				continue
			}

			if len(filesKeys) == 0 {
				continue
			}

			for _, fileKey := range filesKeys {
				names := strings.Split(fileKey, tableFileKeyDelimiter)
				if len(names) != 2 {
					log.Printf("Google cloud storage file [%s] has wrong format! Right format: $filename%s$tablename. This file will be skipped.", fileKey, tableFileKeyDelimiter)
					continue
				}

				if err := bq.bqAdapter.Copy(fileKey, names[1]); err != nil {
					log.Printf("Error copying file [%s] from google cloud storage to BigQuery: %v", fileKey, err)
					continue
				}

				if err := bq.gcsAdapter.DeleteObject(fileKey); err != nil {
					log.Println("System error: file", fileKey, "wasn't deleted from google cloud storage and will be inserted in db again", err)
					continue
				}
			}
		}
	}()
}

func (bq *BigQuery) Store(fileName string, payload []byte) error {
	flatData, err := bq.schemaProcessor.Process(fileName, payload, bq.breakOnError)
	if err != nil {
		return err
	}

	for _, fdata := range flatData {
		dbTableSchema, ok := bq.tables[fdata.DataSchema.Name]
		if !ok {
			//Get or Create Table
			dbTableSchema, err = bq.bqAdapter.GetTableSchema(fdata.DataSchema.Name)
			if err != nil {
				return fmt.Errorf("Error getting table %s schema from BigQuery: %v", fdata.DataSchema.Name, err)
			}
			if !dbTableSchema.Exists() {
				if err := bq.bqAdapter.CreateTable(fdata.DataSchema); err != nil {
					return fmt.Errorf("Error creating table %s in BigQuery: %v", fdata.DataSchema.Name, err)
				}
				dbTableSchema = fdata.DataSchema
			}
			//Save
			bq.tables[dbTableSchema.Name] = dbTableSchema
		}

		schemaDiff := dbTableSchema.Diff(fdata.DataSchema)
		//Patch
		if schemaDiff.Exists() {
			if err := bq.bqAdapter.PatchTableSchema(schemaDiff); err != nil {
				return err
			}
			//Save
			for k, v := range schemaDiff.Columns {
				dbTableSchema.Columns[k] = v
			}
		}
	}

	for _, fdata := range flatData {
		err := bq.gcsAdapter.UploadBytes(fdata.FileName+tableFileKeyDelimiter+fdata.DataSchema.Name, fdata.Payload.Bytes())
		if err != nil {
			return err
		}
	}

	return nil
}

func (bq BigQuery) Name() string {
	return "BigQuery"
}

func (bq BigQuery) Close() (multiErr error) {
	if err := bq.gcsAdapter.Close(); err != nil {
		multiErr = multierror.Append(multiErr, err)
	}
	if err := bq.bqAdapter.Close(); err != nil {
		multiErr = multierror.Append(multiErr, err)
	}
	return
}
