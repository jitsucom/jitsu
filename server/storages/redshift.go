package storages

import (
	"context"
	"fmt"
	"github.com/hashicorp/go-multierror"
	"github.com/jitsucom/jitsu/server/adapters"
	"github.com/jitsucom/jitsu/server/appconfig"
	"github.com/jitsucom/jitsu/server/drivers/base"
	"github.com/jitsucom/jitsu/server/logging"
	"github.com/jitsucom/jitsu/server/schema"
)

// AwsRedshift stores files to aws RedShift in two modes:
// batch: via aws s3 in batch mode (1 file = 1 statement)
// stream: via events queue in stream mode (1 object = 1 statement)
type AwsRedshift struct {
	Abstract

	s3Adapter                     *adapters.S3
	redshiftAdapter               *adapters.AwsRedshift
	usersRecognitionConfiguration *UserRecognitionConfiguration
}

func init() {
	RegisterStorage(StorageType{typeName: RedshiftType, createFunc: NewAwsRedshift, isSQL: true})
}

// NewAwsRedshift returns AwsRedshift and start goroutine for aws redshift batch storage or for stream consumer depend on destination mode
func NewAwsRedshift(config *Config) (storage Storage, err error) {
	defer func() {
		if err != nil && storage != nil {
			storage.Close()
			storage = nil
		}
	}()
	redshiftConfig := &adapters.DataSourceConfig{}
	if err = config.destination.GetDestConfig(config.destination.DataSource, redshiftConfig); err != nil {
		return
	}
	//enrich with default parameters
	if redshiftConfig.Port == 0 {
		redshiftConfig.Port = 5439
		logging.Warnf("[%s] port wasn't provided. Will be used default one: %d", config.destinationID, redshiftConfig.Port)
	}
	if redshiftConfig.Schema == "" {
		redshiftConfig.Schema = "public"
		logging.Warnf("[%s] schema wasn't provided. Will be used default one: %s", config.destinationID, redshiftConfig.Schema)
	}
	//default connect timeout seconds
	if _, ok := redshiftConfig.Parameters["connect_timeout"]; !ok {
		redshiftConfig.Parameters["connect_timeout"] = "600"
	}

	dir := adapters.SSLDir(appconfig.Instance.ConfigPath, config.destinationID)
	if err = adapters.ProcessSSL(dir, redshiftConfig); err != nil {
		return
	}

	var s3Adapter *adapters.S3
	var s3config *adapters.S3Config
	s3c, err := config.destination.GetConfig(redshiftConfig.S3, config.destination.S3, &adapters.S3Config{})
	if err != nil {
		return
	}
	s3config, ok := s3c.(*adapters.S3Config)
	if !ok {
		s3config = &adapters.S3Config{}
	}
	if !config.streamMode {
		s3Adapter, err = adapters.NewS3(s3config)
		if err != nil {
			return
		}
	}
	ar := &AwsRedshift{}
	err = ar.Init(config, ar, "", "")
	if err != nil {
		return
	}
	storage = ar

	queryLogger := config.loggerFactory.CreateSQLQueryLogger(config.destinationID)
	ctx := context.WithValue(config.ctx, adapters.CtxDestinationId, config.destinationID)
	redshiftAdapter, err := adapters.NewAwsRedshift(ctx, redshiftConfig, s3config, queryLogger, ar.sqlTypes)
	if err != nil {
		return
	}

	//create db schema if doesn't exist
	err = redshiftAdapter.CreateDbSchema(redshiftConfig.Schema)
	if err != nil {
		redshiftAdapter.Close()
		return
	}

	tableHelper := NewTableHelper(redshiftConfig.Schema, redshiftAdapter, config.coordinationService, config.pkFields, adapters.SchemaToRedshift, config.maxColumns, RedshiftType)

	ar.s3Adapter = s3Adapter
	ar.redshiftAdapter = redshiftAdapter
	ar.usersRecognitionConfiguration = config.usersRecognition

	//Abstract
	ar.tableHelpers = []*TableHelper{tableHelper}
	ar.sqlAdapters = []adapters.SQLAdapter{redshiftAdapter}

	//streaming worker (queue reading)
	ar.streamingWorkers = newStreamingWorkers(config.eventQueue, ar, config.streamingThreadsCount, tableHelper)
	return
}

// storeTable check table schema
// and store data into one table via s3
func (ar *AwsRedshift) storeTable(fdata *schema.ProcessedFile) (*adapters.Table, error) {
	if fdata.RecognitionPayload {
		return ar.Abstract.storeTable(fdata)
	} else {
		_, tableHelper := ar.getAdapters()
		table := tableHelper.MapTableSchema(fdata.BatchHeader)
		dbTable, err := tableHelper.EnsureTableWithoutCaching(ar.ID(), table)
		if err != nil {
			return table, err
		}

		b, err := fdata.GetPayloadBytes(schema.JSONMarshallerInstance)
		if err != nil {
			return dbTable, err
		}
		if err := ar.s3Adapter.UploadBytes(fdata.FileName, b); err != nil {
			return dbTable, err
		}

		if err := ar.redshiftAdapter.Copy(fdata.FileName, dbTable.Name); err != nil {
			return dbTable, fmt.Errorf("Error copying file [%s] from s3 to redshift: %v", fdata.FileName, err)
		}

		if err := ar.s3Adapter.DeleteObject(fdata.FileName); err != nil {
			logging.SystemErrorf("[%s] file %s wasn't deleted from s3: %v", ar.ID(), fdata.FileName, err)
		}

		return dbTable, nil
	}
}

// SyncStore is used in storing chunk of pulled data to AwsRedshift with processing
func (ar *AwsRedshift) SyncStore(overriddenDataSchema *schema.BatchHeader, objects []map[string]interface{}, deleteConditions *base.DeleteConditions, cacheTable bool, needCopyEvent bool) error {
	return syncStoreImpl(ar, overriddenDataSchema, objects, deleteConditions, cacheTable, needCopyEvent)
}

func (ar *AwsRedshift) Clean(tableName string) error {
	return cleanImpl(ar, tableName)
}

// GetUsersRecognition returns users recognition configuration
func (ar *AwsRedshift) GetUsersRecognition() *UserRecognitionConfiguration {
	return ar.usersRecognitionConfiguration
}

// Type returns Redshift type
func (ar *AwsRedshift) Type() string {
	return RedshiftType
}

// Close closes AwsRedshift adapter, fallback logger and streaming worker
func (ar *AwsRedshift) Close() (multiErr error) {
	if err := ar.close(); err != nil {
		multiErr = multierror.Append(multiErr, err)
	}

	if ar.redshiftAdapter != nil {
		if err := ar.redshiftAdapter.Close(); err != nil {
			multiErr = multierror.Append(multiErr, fmt.Errorf("[%s] Error closing redshift datasource: %v", ar.ID(), err))
		}
	}

	return
}
