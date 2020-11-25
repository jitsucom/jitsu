package storages

import (
	"context"
	"errors"
	"fmt"
	"github.com/hashicorp/go-multierror"
	"github.com/jitsucom/eventnative/adapters"
	"github.com/jitsucom/eventnative/appconfig"
	"github.com/jitsucom/eventnative/events"
	"github.com/jitsucom/eventnative/logging"
	"github.com/jitsucom/eventnative/metrics"
	"github.com/jitsucom/eventnative/safego"
	"github.com/jitsucom/eventnative/schema"
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
func NewSnowflake(ctx context.Context, name string, eventQueue *events.PersistentQueue, s3Config *adapters.S3Config,
	gcpConfig *adapters.GoogleConfig, snowflakeConfig *adapters.SnowflakeConfig, processor *schema.Processor,
	breakOnError, streamMode bool, monitorKeeper MonitorKeeper, queryLogger *logging.QueryLogger) (*Snowflake, error) {
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

	snowflakeAdapter, err := CreateSnowflakeAdapter(ctx, s3Config, *snowflakeConfig, queryLogger)
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
func CreateSnowflakeAdapter(ctx context.Context, s3Config *adapters.S3Config, config adapters.SnowflakeConfig,
	queryLogger *logging.QueryLogger) (*adapters.Snowflake, error) {
	snowflakeAdapter, err := adapters.NewSnowflake(ctx, &config, s3Config, queryLogger)
	if err != nil {
		if sferr, ok := err.(*sf.SnowflakeError); ok {
			//schema doesn't exist
			if sferr.Number == sf.ErrObjectNotExistOrAuthorized {
				snowflakeSchema := config.Schema
				config.Schema = ""
				snowflakeAdapter, err := adapters.NewSnowflake(ctx, &config, s3Config, queryLogger)
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

				snowflakeAdapter, err = adapters.NewSnowflake(ctx, &config, s3Config, queryLogger)
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
	safego.RunWithRestart(func() {
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
				tableName, tokenId, rowsCount, err := extractDataFromFileName(fileKey)
				if err != nil {
					logging.Errorf("[%s] stage file [%s] has wrong format: %v", s.Name(), fileKey, err)
					continue
				}

				payload, err := s.stageAdapter.GetObject(fileKey)
				if err != nil {
					logging.Errorf("[%s] Error getting file %s from stage in Snowflake storage: %v", s.Name(), fileKey, err)
					metrics.ErrorTokenEvents(tokenId, s.Name(), rowsCount)
					continue
				}

				lines := strings.Split(string(payload), "\n")
				if len(lines) == 0 {
					logging.Errorf("[%s] Error reading stage file %s payload in Snowflake storage: empty file", s.Name(), fileKey)
					metrics.ErrorTokenEvents(tokenId, s.Name(), rowsCount)
					continue
				}
				header := lines[0]
				if header == "" {
					logging.Errorf("[%s] Error reading stage file %s header in Snowflake storage: %v", s.Name(), fileKey, err)
					metrics.ErrorTokenEvents(tokenId, s.Name(), rowsCount)
					continue
				}

				wrappedTx, err := s.snowflakeAdapter.OpenTx()
				if err != nil {
					logging.Errorf("[%s] Error creating snowflake transaction: %v", s.Name(), err)
					metrics.ErrorTokenEvents(tokenId, s.Name(), rowsCount)
					continue
				}

				if err := s.snowflakeAdapter.Copy(wrappedTx, fileKey, header, tableName); err != nil {
					logging.Errorf("[%s] Error copying file [%s] from stage to snowflake: %v", s.Name(), fileKey, err)
					wrappedTx.Rollback()
					metrics.ErrorTokenEvents(tokenId, s.Name(), rowsCount)
					continue
				}

				wrappedTx.Commit()
				metrics.SuccessTokenEvents(tokenId, s.Name(), rowsCount)

				if err := s.stageAdapter.DeleteObject(fileKey); err != nil {
					logging.SystemErrorf("[%s] file %s wasn't deleted from stage and will be inserted in db again: %v", s.Name(), fileKey, err)
					continue
				}

			}
		}
	})
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
//return rowsCount and err if err occurred
//but return 0 and nil if no err
//because Store method doesn't store data to Snowflake(only to stage(S3 or GCP)
func (s *Snowflake) Store(fileName string, payload []byte) (int, error) {
	flatData, err := s.schemaProcessor.ProcessFilePayload(fileName, payload, s.breakOnError)
	if err != nil {
		return 0, err
	}

	var rowsCount int
	for _, fdata := range flatData {
		rowsCount += fdata.GetPayloadLen()
	}

	for _, fdata := range flatData {
		dbSchema, err := s.tableHelper.EnsureTable(s.Name(), fdata.DataSchema)
		if err != nil {
			return rowsCount, err
		}

		if err := s.schemaProcessor.ApplyDBTyping(dbSchema, fdata); err != nil {
			return rowsCount, err
		}
	}

	for _, fdata := range flatData {
		b, fileRows := fdata.GetPayloadBytes(schema.CsvMarshallerInstance)
		err := s.stageAdapter.UploadBytes(buildDataIntoFileName(fdata, fileRows), b)
		if err != nil {
			return fileRows, err
		}
	}

	return 0, nil
}

func (s *Snowflake) SyncStore(objects []map[string]interface{}) (int, error) {
	return 0, errors.New("Snowflake doesn't support sync store")
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

	if s.stageAdapter != nil {
		if err := s.stageAdapter.Close(); err != nil {
			multiErr = multierror.Append(multiErr, fmt.Errorf("[%s] Error closing snowflake stage: %v", s.Name(), err))
		}
	}

	if s.streamingWorker != nil {
		s.streamingWorker.Close()
	}

	return
}
