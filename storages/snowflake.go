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
	sf "github.com/snowflakedb/gosnowflake"
	"log"
	"strings"
	"time"
)

const snowflakeStorageType = "Snowflake"

//Store files to Snowflake in two modes:
//batch: via aws s3 in batch mode (1 file = 1 transaction)
//stream: via events queue in stream mode (1 object = 1 transaction)
type Snowflake struct {
	name             string
	s3Adapter        *adapters.S3
	snowflakeAdapter *adapters.Snowflake
	tableHelper      *TableHelper
	schemaProcessor  *schema.Processor
	eventQueue       *events.PersistentQueue
	breakOnError     bool
}

//NewSnowflake return Snowflake and start goroutine for Snowflake batch storage or for stream consumer depend on destination mode
func NewSnowflake(ctx context.Context, name, fallbackDir string, s3Config *adapters.S3Config, snowflakeConfig *adapters.SnowflakeConfig,
	processor *schema.Processor, breakOnError, streamMode bool, monitorKeeper MonitorKeeper) (*Snowflake, error) {
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

	snowflakeAdapter, err := CreateSnowflakeAdapter(ctx, s3Config, *snowflakeConfig)
	if err != nil {
		return nil, err
	}

	tableHelper := NewTableHelper(snowflakeAdapter, monitorKeeper, snowflakeStorageType)

	ar := &Snowflake{
		name:             name,
		s3Adapter:        s3Adapter,
		snowflakeAdapter: snowflakeAdapter,
		tableHelper:      tableHelper,
		schemaProcessor:  processor,
		eventQueue:       eventQueue,
		breakOnError:     breakOnError,
	}

	if streamMode {
		ar.startStreamingConsumer()
	} else {
		ar.startBatchStorage()
	}

	return ar, nil
}

//create snowflake adapter with schema
//if schema doesn't exist - snowflake returns error. In this case connect without schema and create it
func CreateSnowflakeAdapter(ctx context.Context, s3Config *adapters.S3Config, config adapters.SnowflakeConfig) (*adapters.Snowflake, error) {
	snowflakeAdapter, err := adapters.NewSnowflake(ctx, &config, s3Config)
	if err != nil {
		if sferr, ok := err.(*sf.SnowflakeError); ok {
			//schema doesn't exist
			if sferr.Number == sf.ErrObjectNotExistOrAuthorized {
				snowflakeSchema := config.Schema
				config.Schema = ""
				snowflakeAdapter, err := adapters.NewSnowflake(ctx, &config, s3Config)
				if err != nil {
					return nil, err
				}
				config.Schema = snowflakeSchema
				//create schema and reconnect
				err = snowflakeAdapter.CreateDbSchema(config.Schema)
				if err != nil {
					return nil, err
				}
				snowflakeAdapter.Close()

				snowflakeAdapter, err = adapters.NewSnowflake(ctx, &config, s3Config)
				if err != nil {
					return nil, err
				}
				return snowflakeAdapter, nil
			}
		}
		return nil, err
	}
	return snowflakeAdapter, nil
}

//Run goroutine to:
//1. read from queue
//2. insert in Snowflake
func (s *Snowflake) startStreamingConsumer() {
	go func() {
		for {
			if appstatus.Instance.Idle {
				break
			}
			fact, err := s.eventQueue.DequeueBlock()
			if err != nil {
				log.Println("Error reading event fact from snowflake queue", err)
				continue
			}

			dataSchema, flattenObject, err := s.schemaProcessor.ProcessFact(fact)
			if err != nil {
				log.Printf("Unable to process object %v: %v", fact, err)
				continue
			}

			//don't process empty object
			if !dataSchema.Exists() {
				continue
			}

			if err := s.insert(dataSchema, flattenObject); err != nil {
				log.Printf("Error inserting to snowflake table [%s]: %v", dataSchema.Name, err)
				continue
			}
		}
	}()
}

//Periodically (every 30 seconds):
//1. get all files from aws s3
//2. load them to Snowflake via Copy request
//3. delete file from aws s3
func (s *Snowflake) startBatchStorage() {
	go func() {
		for {
			if appstatus.Instance.Idle {
				break
			}
			//TODO configurable
			time.Sleep(30 * time.Second)

			filesKeys, err := s.s3Adapter.ListBucket(appconfig.Instance.ServerName)
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

				payload, err := s.s3Adapter.GetObject(fileKey)
				if err != nil {
					log.Printf("Error getting file %s from s3 in Snowflake storage: %v", fileKey, err)
					continue
				}

				lines := strings.Split(string(payload), "\n")
				if len(lines) == 0 {
					log.Printf("Error reading s3 file %s payload in Snowflake storage: empty file", fileKey)
					continue
				}
				header := lines[0]
				if header == "" {
					log.Printf("Error reading s3 file %s header in Snowflake storage: %v", fileKey, err)
					continue
				}

				wrappedTx, err := s.snowflakeAdapter.OpenTx()
				if err != nil {
					log.Println("Error creating snowflake transaction", err)
					continue
				}

				if err := s.snowflakeAdapter.Copy(wrappedTx, fileKey, header, names[1]); err != nil {
					log.Printf("Error copying file [%s] from s3 to snowflake: %v", fileKey, err)
					wrappedTx.Rollback()
					continue
				}

				wrappedTx.Commit()

				if err := s.s3Adapter.DeleteObject(fileKey); err != nil {
					log.Println("System error: file", fileKey, "wasn't deleted from s3 and will be inserted in db again", err)
					continue
				}

			}
		}
	}()
}

//Consume events.Fact and enqueue it
func (s *Snowflake) Consume(fact events.Fact) {
	if err := s.eventQueue.Enqueue(fact); err != nil {
		logSkippedEvent(fact, err)
	}
}

//insert fact in Snowflake
func (s *Snowflake) insert(dataSchema *schema.Table, fact events.Fact) (err error) {
	dbSchema, err := s.tableHelper.EnsureTable(s.Name(), dataSchema)
	if err != nil {
		return err
	}

	if err := s.schemaProcessor.ApplyDBTypingToObject(dbSchema, fact); err != nil {
		return err
	}

	return s.snowflakeAdapter.Insert(dataSchema, fact)
}

//Store file from byte payload to s3 with processing
func (s *Snowflake) Store(fileName string, payload []byte) error {
	flatData, err := s.schemaProcessor.ProcessFilePayload(fileName, payload, s.breakOnError)
	if err != nil {
		return err
	}

	for _, fdata := range flatData {
		dbSchema, err := s.tableHelper.EnsureTable(s.Name(), fdata.DataSchema)
		if err != nil {
			return err
		}

		if err := s.schemaProcessor.ApplyDBTyping(dbSchema, fdata); err != nil {
			return err
		}
	}

	for _, fdata := range flatData {
		err := s.s3Adapter.UploadBytes(fdata.FileName+tableFileKeyDelimiter+fdata.DataSchema.Name, fdata.GetPayloadBytes(schema.CsvMarshallerInstance))
		if err != nil {
			return err
		}
	}

	return nil
}

func (s *Snowflake) Name() string {
	return s.name
}

func (s *Snowflake) Type() string {
	return snowflakeStorageType
}

func (s *Snowflake) Close() (multiErr error) {
	if err := s.snowflakeAdapter.Close(); err != nil {
		multiErr = multierror.Append(multiErr, fmt.Errorf("Error closing snowflake datasource: %v", err))
	}

	if s.eventQueue != nil {
		if err := s.eventQueue.Close(); err != nil {
			multiErr = multierror.Append(multiErr, fmt.Errorf("Error closing snowflake queue: %v", err))
		}
	}

	return
}
