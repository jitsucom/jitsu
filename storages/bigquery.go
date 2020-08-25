package storages

import (
	"context"
	"github.com/hashicorp/go-multierror"
	"github.com/ksensehq/eventnative/adapters"
	"github.com/ksensehq/eventnative/appconfig"
	"github.com/ksensehq/eventnative/appstatus"
	"github.com/ksensehq/eventnative/schema"
	"log"
	"strings"
	"time"
)

const bqStorageType = "BigQuery"

//Store files to google BigQuery via google cloud storage in batch mode (1 file = 1 transaction)
type BigQuery struct {
	name            string
	sourceDir       string
	gcsAdapter      *adapters.GoogleCloudStorage
	bqAdapter       *adapters.BigQuery
	tableHelper     *TableHelper
	schemaProcessor *schema.Processor
	breakOnError    bool
}

func NewBigQuery(ctx context.Context, name, sourceDir string, config *adapters.GoogleConfig, processor *schema.Processor, breakOnError bool) (*BigQuery, error) {
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

	monitorKeeper := NewMonitorKeeper()

	tableHelper := NewTableHelper(bigQueryAdapter, monitorKeeper, bqStorageType)

	bq := &BigQuery{
		name:            name,
		sourceDir:       sourceDir,
		gcsAdapter:      gcsAdapter,
		bqAdapter:       bigQueryAdapter,
		tableHelper:     tableHelper,
		schemaProcessor: processor,
		breakOnError:    breakOnError,
	}
	fr := &FileReader{dir: sourceDir, storage: bq}
	fr.start()
	bq.start()

	return bq, nil
}

//Periodically (every 30 seconds):
//1. get all files from google cloud storage
//2. load them to BigQuery via google api
//3. delete file from google cloud storage
func (bq *BigQuery) start() {
	go func() {
		for {
			if appstatus.Instance.Idle {
				break
			}
			//TODO configurable
			time.Sleep(30 * time.Second)

			filesKeys, err := bq.gcsAdapter.ListBucket(appconfig.Instance.ServerName)
			if err != nil {
				log.Println("Error reading files from google cloud storage:", err)
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

//ProcessFilePayload file payload
//Ensure table
//Upload payload as a file to google cloud storage
func (bq *BigQuery) Store(fileName string, payload []byte) error {
	flatData, err := bq.schemaProcessor.ProcessFilePayload(fileName, payload, bq.breakOnError)
	if err != nil {
		return err
	}

	for _, fdata := range flatData {
		dbSchema, err := bq.tableHelper.EnsureTable(fdata.DataSchema)
		if err != nil {
			return err
		}

		if err := bq.schemaProcessor.ApplyDBTyping(dbSchema, fdata); err != nil {
			return err
		}
	}

	for _, fdata := range flatData {
		err := bq.gcsAdapter.UploadBytes(fdata.FileName+tableFileKeyDelimiter+fdata.DataSchema.Name, fdata.GetPayloadBytes())
		if err != nil {
			return err
		}
	}

	return nil
}

func (bq *BigQuery) Name() string {
	return bq.name
}

func (bq *BigQuery) Type() string {
	return bqStorageType
}

func (bq *BigQuery) SourceDir() string {
	return bq.sourceDir
}

func (bq *BigQuery) Close() (multiErr error) {
	if err := bq.gcsAdapter.Close(); err != nil {
		multiErr = multierror.Append(multiErr, err)
	}
	if err := bq.bqAdapter.Close(); err != nil {
		multiErr = multierror.Append(multiErr, err)
	}
	return
}
