package storages

import (
	"context"
	"errors"
	"fmt"
	"github.com/hashicorp/go-multierror"
	"github.com/jitsucom/jitsu/server/adapters"
	"github.com/jitsucom/jitsu/server/drivers/base"
	"github.com/jitsucom/jitsu/server/logging"
	"github.com/jitsucom/jitsu/server/schema"
	"github.com/jitsucom/jitsu/server/typing"
	sf "github.com/snowflakedb/gosnowflake"
)

//Snowflake stores files to Snowflake in two modes:
//batch: via aws s3 (or gcp) in batch mode (1 file = 1 transaction)
//stream: via events queue in stream mode (1 object = 1 transaction)
type Snowflake struct {
	Abstract

	stageAdapter                  adapters.Stage
	snowflakeAdapter              *adapters.Snowflake
	usersRecognitionConfiguration *UserRecognitionConfiguration
}

func init() {
	RegisterStorage(StorageType{typeName: SnowflakeType, createFunc: NewSnowflake, isSQL: true})
}

//NewSnowflake returns Snowflake and start goroutine for Snowflake batch storage or for stream consumer depend on destination mode
func NewSnowflake(config *Config) (storage Storage, err error) {
	defer func() {
		if err != nil && storage != nil {
			storage.Close()
			storage = nil
		}
	}()
	snowflakeConfig := &adapters.SnowflakeConfig{}
	if err = config.destination.GetDestConfig(config.destination.Snowflake, snowflakeConfig); err != nil {
		return
	}
	if snowflakeConfig.Schema == "" {
		snowflakeConfig.Schema = "PUBLIC"
		logging.Warnf("[%s] schema wasn't provided. Will be used default one: %s", config.destinationID, snowflakeConfig.Schema)
	}

	//default client_session_keep_alive
	if _, ok := snowflakeConfig.Parameters["client_session_keep_alive"]; !ok {
		t := "true"
		snowflakeConfig.Parameters["client_session_keep_alive"] = &t
	}
	var googleConfig *adapters.GoogleConfig
	gc, err := config.destination.GetConfig(snowflakeConfig.Google, config.destination.Google, &adapters.GoogleConfig{})
	if err != nil {
		return
	}
	googleConfig, googleOk := gc.(*adapters.GoogleConfig)
	if googleOk {
		if err = googleConfig.Validate(); err != nil {
			return
		}
		if !config.streamMode {
			if err = googleConfig.ValidateBatchMode(); err != nil {
				return
			}
		}

		//stage is required when gcp integration
		if snowflakeConfig.Stage == "" {
			return nil, errors.New("Snowflake stage is required parameter in GCP integration")
		}
	}

	var stageAdapter adapters.Stage
	var s3config *adapters.S3Config
	s3c, err := config.destination.GetConfig(snowflakeConfig.S3, config.destination.S3, &adapters.S3Config{})
	if err != nil {
		return
	}
	s3config, s3ok := s3c.(*adapters.S3Config)
	if !config.streamMode {
		if s3ok {
			stageAdapter, err = adapters.NewS3(s3config)
			if err != nil {
				return
			}
		} else {
			stageAdapter, err = adapters.NewGoogleCloudStorage(config.ctx, googleConfig)
			if err != nil {
				return
			}
		}
	}
	snowflake := &Snowflake{stageAdapter: stageAdapter}
	err = snowflake.Init(config, snowflake, "", "")
	if err != nil {
		return
	}
	storage = snowflake
	queryLogger := config.loggerFactory.CreateSQLQueryLogger(config.destinationID)
	snowflakeAdapter, err := CreateSnowflakeAdapter(config.ctx, s3config, *snowflakeConfig, queryLogger, snowflake.sqlTypes)
	if err != nil {
		return
	}

	tableHelper := NewTableHelper(snowflakeConfig.Schema, snowflakeAdapter, config.coordinationService, config.pkFields, adapters.SchemaToSnowflake, config.maxColumns, SnowflakeType)

	snowflake.snowflakeAdapter = snowflakeAdapter
	snowflake.usersRecognitionConfiguration = config.usersRecognition

	//Abstract
	snowflake.tableHelpers = []*TableHelper{tableHelper}
	snowflake.sqlAdapters = []adapters.SQLAdapter{snowflakeAdapter}

	//streaming worker (queue reading)
	snowflake.streamingWorker = newStreamingWorker(config.eventQueue, snowflake, tableHelper)
	return
}

//CreateSnowflakeAdapter creates snowflake adapter with schema
//if schema doesn't exist - snowflake returns error. In this case connect without schema and create it
func CreateSnowflakeAdapter(ctx context.Context, s3Config *adapters.S3Config, config adapters.SnowflakeConfig,
	queryLogger *logging.QueryLogger, sqlTypes typing.SQLTypes) (*adapters.Snowflake, error) {
	snowflakeAdapter, err := adapters.NewSnowflake(ctx, &config, s3Config, queryLogger, sqlTypes)
	if err != nil {
		if sferr, ok := err.(*sf.SnowflakeError); ok {
			//schema doesn't exist
			if sferr.Number == sf.ErrObjectNotExistOrAuthorized {
				snowflakeSchema := config.Schema
				config.Schema = ""
				//create adapter without a certain schema
				tmpSnowflakeAdapter, err := adapters.NewSnowflake(ctx, &config, s3Config, queryLogger, sqlTypes)
				if err != nil {
					return nil, err
				}
				defer tmpSnowflakeAdapter.Close()

				config.Schema = snowflakeSchema
				//create schema and reconnect
				if err = tmpSnowflakeAdapter.CreateDbSchema(config.Schema); err != nil {
					return nil, err
				}

				//create adapter with a certain schema
				snowflakeAdapterWithSchema, err := adapters.NewSnowflake(ctx, &config, s3Config, queryLogger, sqlTypes)
				if err != nil {
					return nil, err
				}
				return snowflakeAdapterWithSchema, nil
			}
		}
		return nil, err
	}
	return snowflakeAdapter, nil
}

//storeTable check table schema
//and store data into one table via stage (google cloud storage or s3)
func (s *Snowflake) storeTable(fdata *schema.ProcessedFile) (*adapters.Table, error) {
	if fdata.RecognitionPayload {
		return s.Abstract.storeTable(fdata)
	} else {
		_, tableHelper := s.getAdapters()
		table := tableHelper.MapTableSchema(fdata.BatchHeader)
		dbTable, err := tableHelper.EnsureTableWithoutCaching(s.ID(), table)
		if err != nil {
			return table, err
		}

		b, header, err := fdata.GetPayloadBytesWithHeader(schema.CSVMarshallerInstance)
		if err != nil {
			return dbTable, err
		}
		if err := s.stageAdapter.UploadBytes(fdata.FileName, b); err != nil {
			return dbTable, err
		}

		if err := s.snowflakeAdapter.Copy(fdata.FileName, dbTable.Name, header); err != nil {
			return dbTable, fmt.Errorf("Error copying file [%s] from stage to snowflake: %v", fdata.FileName, err)
		}

		if err := s.stageAdapter.DeleteObject(fdata.FileName); err != nil {
			logging.SystemErrorf("[%s] file %s wasn't deleted from stage: %v", s.ID(), fdata.FileName, err)
		}

		return dbTable, nil
	}
}

//GetUsersRecognition returns users recognition configuration
func (s *Snowflake) GetUsersRecognition() *UserRecognitionConfiguration {
	return s.usersRecognitionConfiguration
}

// SyncStore is used in storing chunk of pulled data to Snowflake with processing
func (s *Snowflake) SyncStore(overriddenDataSchema *schema.BatchHeader, objects []map[string]interface{}, deleteConditions *base.DeleteConditions, cacheTable bool, needCopyEvent bool) error {
	return syncStoreImpl(s, overriddenDataSchema, objects, deleteConditions, cacheTable, needCopyEvent)
}

func (s *Snowflake) Clean(tableName string) error {
	return cleanImpl(s, tableName)
}

//Type returns Snowflake type
func (s *Snowflake) Type() string {
	return SnowflakeType
}

//Close closes Snowflake adapter, stage adapter, fallback logger and streaming worker
func (s *Snowflake) Close() (multiErr error) {
	if s.streamingWorker != nil {
		if err := s.streamingWorker.Close(); err != nil {
			multiErr = multierror.Append(multiErr, fmt.Errorf("[%s] Error closing streaming worker: %v", s.ID(), err))
		}
	}
	if s.snowflakeAdapter != nil {
		if err := s.snowflakeAdapter.Close(); err != nil {
			multiErr = multierror.Append(multiErr, fmt.Errorf("[%s] Error closing snowflake datasource: %v", s.ID(), err))
		}
	}
	if s.stageAdapter != nil {
		if err := s.stageAdapter.Close(); err != nil {
			multiErr = multierror.Append(multiErr, fmt.Errorf("[%s] Error closing snowflake stage: %v", s.ID(), err))
		}
	}

	if err := s.close(); err != nil {
		multiErr = multierror.Append(multiErr, err)
	}

	return
}
