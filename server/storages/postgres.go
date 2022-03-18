package storages

import (
	"context"
	"fmt"
	"github.com/hashicorp/go-multierror"
	"github.com/jitsucom/jitsu/server/adapters"
	"github.com/jitsucom/jitsu/server/appconfig"
	"github.com/jitsucom/jitsu/server/logging"
	"github.com/jitsucom/jitsu/server/schema"
)

//Postgres stores files to Postgres in two modes:
//batch: (1 file = 1 statement)
//stream: (1 object = 1 statement)
type Postgres struct {
	Abstract

	adapter                       *adapters.Postgres
	usersRecognitionConfiguration *UserRecognitionConfiguration
}

func init() {
	RegisterStorage(StorageType{typeName: PostgresType, createFunc: NewPostgres, isSQL: true})
}

//NewPostgres returns configured Postgres Destination
func NewPostgres(config *Config) (storage Storage, err error) {
	defer func() {
		if err != nil && storage != nil {
			storage.Close()
			storage = nil
		}
	}()
	pgConfig := &adapters.DataSourceConfig{}
	if err = config.destination.GetDestConfig(config.destination.DataSource, pgConfig); err != nil {
		return
	}
	//enrich with default parameters
	if pgConfig.Port == 0 {
		pgConfig.Port = 5432
		logging.Warnf("[%s] port wasn't provided. Will be used default one: %d", config.destinationID, pgConfig.Port)
	}
	if pgConfig.Schema == "" {
		pgConfig.Schema = "public"
		logging.Warnf("[%s] schema wasn't provided. Will be used default one: %s", config.destinationID, pgConfig.Schema)
	}
	//default connect timeout seconds
	if _, ok := pgConfig.Parameters["connect_timeout"]; !ok {
		pgConfig.Parameters["connect_timeout"] = "600"
	}

	dir := adapters.SSLDir(appconfig.Instance.ConfigPath, config.destinationID)
	if err = adapters.ProcessSSL(dir, pgConfig); err != nil {
		return
	}
	p := &Postgres{}
	err = p.Init(config, p, "", "")
	if err != nil {
		return
	}
	storage = p

	queryLogger := config.loggerFactory.CreateSQLQueryLogger(config.destinationID)
	ctx := context.WithValue(config.ctx, adapters.CtxDestinationId, config.destinationID)
	adapter, err := adapters.NewPostgres(ctx, pgConfig, queryLogger, p.sqlTypes)
	if err != nil {
		return
	}

	//create db schema if doesn't exist
	err = adapter.CreateDbSchema(pgConfig.Schema)
	if err != nil {
		adapter.Close()
		return
	}

	tableHelper := NewTableHelper(pgConfig.Schema, adapter, config.coordinationService, config.pkFields, adapters.SchemaToPostgres, config.maxColumns, PostgresType)

	p.adapter = adapter
	p.usersRecognitionConfiguration = config.usersRecognition

	p.tableHelpers = []*TableHelper{tableHelper}
	p.sqlAdapters = []adapters.SQLAdapter{adapter}

	//streaming worker (queue reading)
	p.streamingWorker = newStreamingWorker(config.eventQueue, p, tableHelper)
	return
}

//SyncStore is used in storing chunk of pulled data to Postgres with processing
func (p *Postgres) SyncStore(overriddenDataSchema *schema.BatchHeader, objects []map[string]interface{}, timeIntervalValue string, cacheTable bool, needCopyEvent bool) error {
	return syncStoreImpl(p, overriddenDataSchema, objects, timeIntervalValue, cacheTable, needCopyEvent)
}

func (p *Postgres) Clean(tableName string) error {
	return cleanImpl(p, tableName)
}

//GetUsersRecognition returns users recognition configuration
func (p *Postgres) GetUsersRecognition() *UserRecognitionConfiguration {
	return p.usersRecognitionConfiguration
}

//Type returns Facebook type
func (p *Postgres) Type() string {
	return PostgresType
}

//Close closes Postgres adapter, fallback logger and streaming worker
func (p *Postgres) Close() (multiErr error) {
	if p.streamingWorker != nil {
		if err := p.streamingWorker.Close(); err != nil {
			multiErr = multierror.Append(multiErr, fmt.Errorf("[%s] Error closing streaming worker: %v", p.ID(), err))
		}
	}

	if p.adapter != nil {
		if err := p.adapter.Close(); err != nil {
			multiErr = multierror.Append(multiErr, fmt.Errorf("[%s] Error closing postgres datasource: %v", p.ID(), err))
		}
	}

	if err := p.close(); err != nil {
		multiErr = multierror.Append(multiErr, err)
	}

	return
}
