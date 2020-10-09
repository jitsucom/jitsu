package storages

import (
	"context"
	"fmt"
	"github.com/hashicorp/go-multierror"
	"github.com/ksensehq/eventnative/adapters"
	"github.com/ksensehq/eventnative/appconfig"
	"github.com/ksensehq/eventnative/events"
	"github.com/ksensehq/eventnative/logging"
	"github.com/ksensehq/eventnative/schema"
	sf "github.com/snowflakedb/gosnowflake"
	"strings"
	"time"
)

//Store files to Snowflake in two modes:
//batch: via aws s3 (or gcp) in batch mode (1 file = 1 transaction)
//stream: via events queue in stream mode (1 object = 1 transaction)
type Snowflake struct {
	name             string
	stageAdapter     adapters.Stage
	snowflakeAdapter *adapters.Snowflake
	tableHelper      *TableHelper
	schemaProcessor  *schema.Processor
	streamingWorker  *StreamingWorker
	breakOnError     bool

	closed bool
}

//NewSnowflake return Snowflake and start goroutine for Snowflake batch storage or for stream consumer depend on destination mode
func NewSnowflake(ctx context.Context, name string, eventQueue *events.PersistentQueue, s3Config *adapters.S3Config, gcpConfig *adapters.GoogleConfig,
	snowflakeConfig *adapters.SnowflakeConfig, processor *schema.Processor, breakOnError, streamMode bool, monitorKeeper MonitorKeeper) (*Snowflake, error) {
	var stageAdapter adapters.Stage
	if !streamMode {
		var err error
		if s3Config != nil {
			stageAdapter, err = adapters.NewS3(s3Config)
			if err != nil {
				return nil, err
			}
		} else {
			stageAdapter, err = adapters.NewGoogleCloudStorage(ctx, gcpConfig)
			if err != nil {
				return nil, err
			}
		}
	}

	snowflakeAdapter, err := CreateSnowflakeAdapter(ctx, s3Config, *snowflakeConfig)
	if err != nil {
		if stageAdapter != nil {
			stageAdapter.Close()
		}
		return nil, err
	}

	tableHelper := NewTableHelper(snowflakeAdapter, monitorKeeper, SnowflakeType)

	snowflake := &Snowflake{
		name:             name,
		stageAdapter:     stageAdapter,
		snowflakeAdapter: snowflakeAdapter,
		tableHelper:      tableHelper,
		schemaProcessor:  processor,
		breakOnError:     breakOnError,
	}

	if streamMode {
		snowflake.streamingWorker = newStreamingWorker(eventQueue, processor, snowflake)
		snowflake.streamingWorker.start()
	} else {
		snowflake.startBatch()
	}

	return snowflake, nil
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

//Periodically (every 30 seconds):
//1. get all files from stage (aws s3 or gcp)
//2. load them to Snowflake via Copy request
//3. delete file from stage
func (s *Snowflake) startBatch() {
	go func() {
		for {
			if s.closed {
				break
			}
			//TODO configurable
			time.Sleep(30 * time.Second)

			filesKeys, err := s.stageAdapter.ListBucket(appconfig.Instance.ServerName)
			if err != nil {
				logging.Errorf("[%s] Error reading files from stage: %v", s.Name(), err)
				continue
			}

			if len(filesKeys) == 0 {
				continue
			}

			for _, fileKey := range filesKeys {
				names := strings.Split(fileKey, tableFileKeyDelimiter)
				if len(names) != 2 {
					logging.Errorf("[%s] S3 file [%s] has wrong format! Right format: $filename%s$tablename. This file will be skipped.", s.Name(), fileKey, tableFileKeyDelimiter)
					continue
				}

				payload, err := s.stageAdapter.GetObject(fileKey)
				if err != nil {
					logging.Errorf("[%s] Error getting file %s from stage in Snowflake storage: %v", s.Name(), fileKey, err)
					continue
				}

				lines := strings.Split(string(payload), "\n")
				if len(lines) == 0 {
					logging.Errorf("[%s] Error reading stage file %s payload in Snowflake storage: empty file", s.Name(), fileKey)
					continue
				}
				header := lines[0]
				if header == "" {
					logging.Errorf("[%s] Error reading stage file %s header in Snowflake storage: %v", s.Name(), fileKey, err)
					continue
				}

				wrappedTx, err := s.snowflakeAdapter.OpenTx()
				if err != nil {
					logging.Errorf("[%s] Error creating snowflake transaction: %v", s.Name(), err)
					continue
				}

				if err := s.snowflakeAdapter.Copy(wrappedTx, fileKey, header, names[1]); err != nil {
					logging.Errorf("[%s] Error copying file [%s] from stage to snowflake: %v", s.Name(), fileKey, err)
					wrappedTx.Rollback()
					continue
				}

				wrappedTx.Commit()

				if err := s.stageAdapter.DeleteObject(fileKey); err != nil {
					logging.Errorf("[%s] System error: file %s wasn't deleted from stage and will be inserted in db again: %v", s.Name(), fileKey, err)
					continue
				}

			}
		}
	}()
}

//Insert fact in Snowflake
func (s *Snowflake) Insert(dataSchema *schema.Table, fact events.Fact) (err error) {
	dbSchema, err := s.tableHelper.EnsureTable(s.Name(), dataSchema)
	if err != nil {
		return err
	}

	if err := s.schemaProcessor.ApplyDBTypingToObject(dbSchema, fact); err != nil {
		return err
	}

	return s.snowflakeAdapter.Insert(dataSchema, fact)
}

//Store file from byte payload to stage with processing
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
		err := s.stageAdapter.UploadBytes(fdata.FileName+tableFileKeyDelimiter+fdata.DataSchema.Name, fdata.GetPayloadBytes(schema.CsvMarshallerInstance))
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
	return SnowflakeType
}

func (s *Snowflake) Close() (multiErr error) {
	s.closed = true

	if err := s.snowflakeAdapter.Close(); err != nil {
		multiErr = multierror.Append(multiErr, fmt.Errorf("[%s] Error closing snowflake datasource: %v", s.Name(), err))
	}

	if err := s.stageAdapter.Close(); err != nil {
		multiErr = multierror.Append(multiErr, fmt.Errorf("[%s] Error closing snowflake stage: %v", s.Name(), err))
	}

	if s.streamingWorker != nil {
		s.streamingWorker.Close()
	}

	return
}
