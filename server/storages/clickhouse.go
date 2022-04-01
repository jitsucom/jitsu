package storages

import (
	"fmt"
	"github.com/hashicorp/go-multierror"
	"github.com/jitsucom/jitsu/server/adapters"
	"github.com/jitsucom/jitsu/server/schema"
)

//ClickHouse stores files to ClickHouse in two modes:
//batch: (1 file = 1 statement)
//stream: (1 object = 1 statement)
type ClickHouse struct {
	Abstract

	adapters                      []*adapters.ClickHouse
	chTableHelpers                []*TableHelper
	usersRecognitionConfiguration *UserRecognitionConfiguration
}

func init() {
	RegisterStorage(StorageType{typeName: ClickHouseType, createFunc: NewClickHouse, isSQL: true})
}

//NewClickHouse returns configured ClickHouse instance
func NewClickHouse(config *Config) (storage Storage, err error) {
	defer func() {
		if err != nil && storage != nil {
			storage.Close()
			storage = nil
		}
	}()

	chConfig := &adapters.ClickHouseConfig{}
	if err = config.destination.GetDestConfig(config.destination.ClickHouse, chConfig); err != nil {
		return
	}

	tableStatementFactory, err := adapters.NewTableStatementFactory(chConfig)
	if err != nil {
		return
	}

	nullableFields := map[string]bool{}
	if chConfig.Engine != nil {
		for _, fieldName := range chConfig.Engine.NullableFields {
			nullableFields[fieldName] = true
		}
	}

	queryLogger := config.loggerFactory.CreateSQLQueryLogger(config.destinationID)
	ch := &ClickHouse{}
	err = ch.Init(config, ch, "", "")
	if err != nil {
		return
	}
	storage = ch

	//creating tableHelpers and Adapters
	//1 helper+adapter per ClickHouse node
	var sqlAdapters []adapters.SQLAdapter
	for _, dsn := range chConfig.Dsns {
		var adapter *adapters.ClickHouse
		adapter, err = adapters.NewClickHouse(config.ctx, dsn, chConfig.Database, chConfig.Cluster, chConfig.TLS,
			tableStatementFactory, nullableFields, queryLogger, ch.sqlTypes)
		if err != nil {
			return
		}

		ch.adapters = append(ch.adapters, adapter)
		ch.chTableHelpers = append(ch.chTableHelpers, NewTableHelper("", adapter, config.coordinationService, config.pkFields, adapters.SchemaToClickhouse, config.maxColumns, ClickHouseType))
		sqlAdapters = append(sqlAdapters, adapter)
	}

	ch.usersRecognitionConfiguration = config.usersRecognition
	if err != nil {
		return
	}
	//Abstract
	ch.tableHelpers = ch.chTableHelpers
	ch.sqlAdapters = sqlAdapters

	err = ch.adapters[0].CreateDB(chConfig.Database)
	if err != nil {
		return
	}

	//streaming worker (queue reading)
	ch.streamingWorker = newStreamingWorker(config.eventQueue, ch, ch.chTableHelpers...)
	return
}

//Type returns ClickHouse type
func (ch *ClickHouse) Type() string {
	return ClickHouseType
}

//SyncStore is used in storing chunk of pulled data to ClickHouse with processing
func (ch *ClickHouse) SyncStore(overriddenDataSchema *schema.BatchHeader, objects []map[string]interface{}, timeIntervalValue string, cacheTable bool, needCopyEvent bool) error {
	return syncStoreImpl(ch, overriddenDataSchema, objects, timeIntervalValue, cacheTable, needCopyEvent)
}

func (ch *ClickHouse) Clean(tableName string) error {
	return cleanImpl(ch, tableName)
}

//GetUsersRecognition returns users recognition configuration
func (ch *ClickHouse) GetUsersRecognition() *UserRecognitionConfiguration {
	return ch.usersRecognitionConfiguration
}

//Close closes ClickHouse adapters, fallback logger and streaming worker
func (ch *ClickHouse) Close() (multiErr error) {
	if ch.streamingWorker != nil {
		if err := ch.streamingWorker.Close(); err != nil {
			multiErr = multierror.Append(multiErr, fmt.Errorf("[%s] Error closing streaming worker: %v", ch.ID(), err))
		}
	}

	for i, adapter := range ch.adapters {
		if err := adapter.Close(); err != nil {
			multiErr = multierror.Append(multiErr, fmt.Errorf("[%s] Error closing clickhouse datasource[%d]: %v", ch.ID(), i, err))
		}
	}

	if err := ch.close(); err != nil {
		multiErr = multierror.Append(multiErr, err)
	}

	return
}
