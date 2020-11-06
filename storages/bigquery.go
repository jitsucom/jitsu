package storages

import (
	"context"
	"errors"
	"fmt"
	"github.com/hashicorp/go-multierror"
	"github.com/ksensehq/eventnative/adapters"
	"github.com/ksensehq/eventnative/appconfig"
	"github.com/ksensehq/eventnative/events"
	"github.com/ksensehq/eventnative/logging"
	"github.com/ksensehq/eventnative/metrics"
	"github.com/ksensehq/eventnative/schema"
	"time"
)

//Store files to google BigQuery in two modes:
//batch: via google cloud storage in batch mode (1 file = 1 transaction)
//stream: via events queue in stream mode (1 object = 1 transaction)
type BigQuery struct {
	name            string
	gcsAdapter      *adapters.GoogleCloudStorage
	bqAdapter       *adapters.BigQuery
	tableHelper     *TableHelper
	schemaProcessor *schema.Processor
	streamingWorker *StreamingWorker
	breakOnError    bool

	closed bool
}

func NewBigQuery(ctx context.Context, name string, eventQueue *events.PersistentQueue, config *adapters.GoogleConfig, processor *schema.Processor,
	breakOnError, streamMode bool, monitorKeeper MonitorKeeper) (*BigQuery, error) {
	var gcsAdapter *adapters.GoogleCloudStorage
	if !streamMode {
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
		bigQueryAdapter.Close()
		if gcsAdapter != nil {
			gcsAdapter.Close()
		}
		return nil, err
	}

	tableHelper := NewTableHelper(bigQueryAdapter, monitorKeeper, BigQueryType)

	bq := &BigQuery{
		name:            name,
		gcsAdapter:      gcsAdapter,
		bqAdapter:       bigQueryAdapter,
		tableHelper:     tableHelper,
		schemaProcessor: processor,
		breakOnError:    breakOnError,
	}
	if streamMode {
		bq.streamingWorker = newStreamingWorker(eventQueue, processor, bq)
		bq.streamingWorker.start()
	} else {
		bq.startBatch()
	}

	return bq, nil
}

//Periodically (every 30 seconds):
//1. get all files from google cloud storage
//2. load them to BigQuery via google api
//3. delete file from google cloud storage
func (bq *BigQuery) startBatch() {
	go func() {
		for {
			if bq.closed {
				break
			}
			//TODO configurable
			time.Sleep(30 * time.Second)

			filesKeys, err := bq.gcsAdapter.ListBucket(appconfig.Instance.ServerName)
			if err != nil {
				logging.Errorf("[%s] Error reading files from google cloud storage: %v", bq.Name(), err)
				continue
			}

			if len(filesKeys) == 0 {
				continue
			}

			for _, fileKey := range filesKeys {
				tableName, tokenId, rowsCount, err := extractDataFromFileName(fileKey)
				if err != nil {
					logging.Errorf("[%s] Google cloud storage file [%s] has wrong format: %v", bq.Name(), fileKey, err)
					continue
				}

				if err := bq.bqAdapter.Copy(fileKey, tableName); err != nil {
					logging.Errorf("[%s] Error copying file [%s] from google cloud storage to BigQuery: %v", bq.Name(), fileKey, err)
					metrics.ErrorTokenEvents(tokenId, bq.Name(), rowsCount)
					continue
				}

				metrics.SuccessTokenEvents(tokenId, bq.Name(), rowsCount)

				if err := bq.gcsAdapter.DeleteObject(fileKey); err != nil {
					logging.Errorf("[%s] System error: file %s wasn't deleted from google cloud storage and will be inserted in db again: %v", bq.Name(), fileKey, err)
					continue
				}
			}
		}
	}()
}

//Insert fact in BigQuery
func (bq *BigQuery) Insert(dataSchema *schema.Table, fact events.Fact) (err error) {
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
//return rowsCount and err if err occurred
//but return 0 and nil if no err
//because Store method doesn't store data to BigQuery(only to GCP)
func (bq *BigQuery) Store(fileName string, payload []byte) (int, error) {
	flatData, err := bq.schemaProcessor.ProcessFilePayload(fileName, payload, bq.breakOnError)
	if err != nil {
		return linesCount(payload), err
	}

	var rowsCount int
	for _, fdata := range flatData {
		rowsCount += fdata.GetPayloadLen()
	}

	for _, fdata := range flatData {
		dbSchema, err := bq.tableHelper.EnsureTable(bq.Name(), fdata.DataSchema)
		if err != nil {
			return rowsCount, err
		}

		if err := bq.schemaProcessor.ApplyDBTyping(dbSchema, fdata); err != nil {
			return rowsCount, err
		}
	}

	for _, fdata := range flatData {
		b, fileRows := fdata.GetPayloadBytes(schema.JsonMarshallerInstance)
		err := bq.gcsAdapter.UploadBytes(buildDataIntoFileName(fdata, fileRows), b)
		if err != nil {
			return fileRows, err
		}
	}

	return 0, nil
}

func (bq *BigQuery) SyncStore(objects []map[string]interface{}) (int, error) {
	return 0, errors.New("BigQuery doesn't support sync store")
}

func (bq *BigQuery) Name() string {
	return bq.name
}

func (bq *BigQuery) Type() string {
	return BigQueryType
}

func (bq *BigQuery) Close() (multiErr error) {
	bq.closed = true

	if err := bq.gcsAdapter.Close(); err != nil {
		multiErr = multierror.Append(multiErr, fmt.Errorf("[%s] Error closing google cloud storage client: %v", bq.Name(), err))
	}
	if err := bq.bqAdapter.Close(); err != nil {
		multiErr = multierror.Append(multiErr, fmt.Errorf("[%s] Error closing BigQuery client: %v", bq.Name(), err))
	}

	if bq.streamingWorker != nil {
		bq.streamingWorker.Close()
	}

	return
}
