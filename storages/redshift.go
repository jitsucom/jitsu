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

const tableFileKeyDelimiter = "-table-"
const redshiftStorageType = "Redshift"

//Store files to aws RedShift in two modes:
//batch: via aws s3 in batch mode (1 file = 1 transaction)
//stream: via events queue in stream mode (1 object = 1 transaction)
type AwsRedshift struct {
	name            string
	s3Adapter       *adapters.S3
	redshiftAdapter *adapters.AwsRedshift
	tableHelper     *TableHelper
	schemaProcessor *schema.Processor
	eventQueue      *events.PersistentQueue
	breakOnError    bool
}

//NewAwsRedshift return AwsRedshift and start goroutine for aws redshift batch storage or for stream consumer depend on destination mode
func NewAwsRedshift(ctx context.Context, name, fallbackDir string, s3Config *adapters.S3Config, redshiftConfig *adapters.DataSourceConfig,
	processor *schema.Processor, breakOnError, streamMode bool) (*AwsRedshift, error) {
	var s3Adapter *adapters.S3
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
		s3Adapter, err = adapters.NewS3(s3Config)
		if err != nil {
			return nil, err
		}
	}

	redshiftAdapter, err := adapters.NewAwsRedshift(ctx, redshiftConfig, s3Config)
	if err != nil {
		return nil, err
	}

	//create db schema if doesn't exist
	err = redshiftAdapter.CreateDbSchema(redshiftConfig.Schema)
	if err != nil {
		return nil, err
	}

	monitorKeeper := NewMonitorKeeper()
	tableHelper := NewTableHelper(redshiftAdapter, monitorKeeper, redshiftStorageType)

	ar := &AwsRedshift{
		name:            name,
		s3Adapter:       s3Adapter,
		redshiftAdapter: redshiftAdapter,
		tableHelper:     tableHelper,
		schemaProcessor: processor,
		eventQueue:      eventQueue,
		breakOnError:    breakOnError,
	}

	if streamMode {
		ar.startStreamingConsumer()
	} else {
		ar.startBatchStorage()
	}

	return ar, nil
}

//Run goroutine to:
//1. read from queue
//2. insert in AwsRedshift
func (ar *AwsRedshift) startStreamingConsumer() {
	go func() {
		for {
			if appstatus.Instance.Idle {
				break
			}
			fact, err := ar.eventQueue.DequeueBlock()
			if err != nil {
				log.Println("Error reading event fact from redshift queue", err)
				continue
			}

			dataSchema, flattenObject, err := ar.schemaProcessor.ProcessFact(fact)
			if err != nil {
				log.Printf("Unable to process object %v: %v", fact, err)
				continue
			}

			//don't process empty object
			if !dataSchema.Exists() {
				continue
			}

			if err := ar.insert(dataSchema, flattenObject); err != nil {
				log.Printf("Error inserting to redshift table [%s]: %v", dataSchema.Name, err)
				continue
			}
		}
	}()
}

//Periodically (every 30 seconds):
//1. get all files from aws s3
//2. load them to aws Redshift via Copy request
//3. delete file from aws s3
func (ar *AwsRedshift) startBatchStorage() {
	go func() {
		for {
			if appstatus.Instance.Idle {
				break
			}
			//TODO configurable
			time.Sleep(30 * time.Second)

			filesKeys, err := ar.s3Adapter.ListBucket(appconfig.Instance.ServerName)
			if err != nil {
				log.Println("Error reading files from s3", err)
				continue
			}

			if len(filesKeys) == 0 {
				continue
			}

			for _, fileKey := range filesKeys {
				names := strings.Split(fileKey, tableFileKeyDelimiter)
				if len(names) != 2 {
					log.Printf("S3 file [%s] has wrong format! Right format: $filename%s$tablename. This file will be skipped.", fileKey, tableFileKeyDelimiter)
					continue
				}
				wrappedTx, err := ar.redshiftAdapter.OpenTx()
				if err != nil {
					log.Println("Error creating redshift transaction", err)
					continue
				}

				if err := ar.redshiftAdapter.Copy(wrappedTx, fileKey, names[1]); err != nil {
					log.Printf("Error copying file [%s] from s3 to redshift: %v", fileKey, err)
					wrappedTx.Rollback()
					continue
				}

				wrappedTx.Commit()
				//TODO may be we need to have a journal for collecting already processed files names
				// if ar.s3Adapter.DeleteObject fails => it will be processed next time => duplicate data
				if err := ar.s3Adapter.DeleteObject(fileKey); err != nil {
					log.Println("System error: file", fileKey, "wasn't deleted from s3 and will be inserted in db again", err)
					continue
				}

			}
		}
	}()
}

//Consume events.Fact and enqueue it
func (ar *AwsRedshift) Consume(fact events.Fact) {
	if err := ar.eventQueue.Enqueue(fact); err != nil {
		logSkippedEvent(fact, err)
	}
}

//insert fact in Redshift
func (ar *AwsRedshift) insert(dataSchema *schema.Table, fact events.Fact) (err error) {
	dbSchema, err := ar.tableHelper.EnsureTable(dataSchema)
	if err != nil {
		return err
	}

	if err := ar.schemaProcessor.ApplyDBTypingToObject(dbSchema, fact); err != nil {
		return err
	}

	return ar.redshiftAdapter.Insert(dataSchema, fact)
}

//Store file from byte payload to s3 with processing
func (ar *AwsRedshift) Store(fileName string, payload []byte) error {
	flatData, err := ar.schemaProcessor.ProcessFilePayload(fileName, payload, ar.breakOnError)
	if err != nil {
		return err
	}

	for _, fdata := range flatData {
		dbSchema, err := ar.tableHelper.EnsureTable(fdata.DataSchema)
		if err != nil {
			return err
		}

		if err := ar.schemaProcessor.ApplyDBTyping(dbSchema, fdata); err != nil {
			return err
		}
	}

	//TODO put them all in one folder and if all ok => move them all to next working folder
	for _, fdata := range flatData {
		err := ar.s3Adapter.UploadBytes(fdata.FileName+tableFileKeyDelimiter+fdata.DataSchema.Name, fdata.GetPayloadBytes())
		if err != nil {
			return err
		}
	}

	return nil
}

func (ar *AwsRedshift) Name() string {
	return ar.name
}

func (ar *AwsRedshift) Type() string {
	return redshiftStorageType
}

func (ar *AwsRedshift) Close() (multiErr error) {
	if err := ar.redshiftAdapter.Close(); err != nil {
		multiErr = multierror.Append(multiErr, fmt.Errorf("Error closing redshift datasource: %v", err))
	}

	if ar.eventQueue != nil {
		if err := ar.eventQueue.Close(); err != nil {
			multiErr = multierror.Append(multiErr, fmt.Errorf("Error closing redshift queue: %v", err))
		}
	}

	return
}
