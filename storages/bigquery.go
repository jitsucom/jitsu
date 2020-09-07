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
	"strings"
	"time"
)

const bqStorageType = "BigQuery"

//Store files to google BigQuery in two modes:
//batch: via google cloud storage in batch mode (1 file = 1 transaction)
//stream: via events queue in stream mode (1 object = 1 transaction)
type BigQuery struct {
	name            string
	gcsAdapter      *adapters.GoogleCloudStorage
	bqAdapter       *adapters.BigQuery
	tableHelper     *TableHelper
	schemaProcessor *schema.Processor
	eventQueue      *events.PersistentQueue
	breakOnError    bool
}

func NewBigQuery(ctx context.Context, name, fallbackDir string, config *adapters.GoogleConfig, processor *schema.Processor,
	breakOnError, streamMode bool, monitorKeeper MonitorKeeper) (*BigQuery, error) {
	var gcsAdapter *adapters.GoogleCloudStorage
	var eventQueue *events.PersistentQueue
	if streamMode {
		var err error
		queueName := fmt.Sprintf("%s-%s", appconfig.Instance.ServerName, name)
		eventQueue, err = events.NewPersistentQueue(queueName, fallbackDir)
		if err != nil {
			return nil, err
		}
	} else {
		var err error
		gcsAdapter, err = adapters.NewGoogleCloudStorage(ctx, config)
		if err != nil {
			return nil, err
		}
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

	tableHelper := NewTableHelper(bigQueryAdapter, monitorKeeper, bqStorageType)

	bq := &BigQuery{
		name:            name,
		gcsAdapter:      gcsAdapter,
		bqAdapter:       bigQueryAdapter,
		tableHelper:     tableHelper,
		schemaProcessor: processor,
		eventQueue:      eventQueue,
		breakOnError:    breakOnError,
	}
	if streamMode {
		bq.startStreamingConsumer()
	} else {
		bq.startBatchStorage()
	}

	return bq, nil
}

//Run goroutine to:
//1. read from queue
//2. insert in BigQuery
func (bq *BigQuery) startStreamingConsumer() {
	go func() {
		for {
			if appstatus.Instance.Idle {
				break
			}
			fact, err := bq.eventQueue.DequeueBlock()
			if err != nil {
				log.Println("Error reading event fact from bigquery queue", err)
				continue
			}

			dataSchema, flattenObject, err := bq.schemaProcessor.ProcessFact(fact)
			if err != nil {
				log.Printf("Unable to process object %v: %v", fact, err)
				continue
			}

			//don't process empty object
			if !dataSchema.Exists() {
				continue
			}

			if err := bq.insert(dataSchema, flattenObject); err != nil {
				log.Printf("Error inserting to bigquery table [%s]: %v", dataSchema.Name, err)
				continue
			}
		}
	}()
}

//Periodically (every 30 seconds):
//1. get all files from google cloud storage
//2. load them to BigQuery via google api
//3. delete file from google cloud storage
func (bq *BigQuery) startBatchStorage() {
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

//Consume events.Fact and enqueue it
func (bq *BigQuery) Consume(fact events.Fact) {
	if err := bq.eventQueue.Enqueue(fact); err != nil {
		logSkippedEvent(fact, err)
	}
}

//insert fact in BigQuery
func (bq *BigQuery) insert(dataSchema *schema.Table, fact events.Fact) (err error) {
	dbSchema, err := bq.tableHelper.EnsureTable(bq.Name(), dataSchema)
	if err != nil {
		return err
	}

	if err := bq.schemaProcessor.ApplyDBTypingToObject(dbSchema, fact); err != nil {
		return err
	}

	return bq.bqAdapter.Insert(dataSchema, fact)
}

//Store file from byte payload to google cloud storage with processing
func (bq *BigQuery) Store(fileName string, payload []byte) error {
	flatData, err := bq.schemaProcessor.ProcessFilePayload(fileName, payload, bq.breakOnError)
	if err != nil {
		return err
	}

	for _, fdata := range flatData {
		dbSchema, err := bq.tableHelper.EnsureTable(bq.Name(), fdata.DataSchema)
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

func (bq *BigQuery) Close() (multiErr error) {
	if err := bq.gcsAdapter.Close(); err != nil {
		multiErr = multierror.Append(multiErr, err)
	}
	if err := bq.bqAdapter.Close(); err != nil {
		multiErr = multierror.Append(multiErr, err)
	}

	if bq.eventQueue != nil {
		if err := bq.eventQueue.Close(); err != nil {
			multiErr = multierror.Append(multiErr, fmt.Errorf("Error closing bigquery event queue: %v", err))
		}
	}
	return
}
