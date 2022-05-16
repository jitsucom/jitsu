package storages

import (
	"context"
	"fmt"
	"github.com/go-sql-driver/mysql"
	"github.com/hashicorp/go-multierror"
	"github.com/jitsucom/jitsu/server/adapters"
	"github.com/jitsucom/jitsu/server/events"
	"github.com/jitsucom/jitsu/server/logging"
	"github.com/jitsucom/jitsu/server/schema"
	"github.com/jitsucom/jitsu/server/typing"
)

//MySQL stores files to MySQL in two modes:
//batch: (1 file = 1 statement)
//stream: (1 object = 1 statement)
type MySQL struct {
	Abstract

	adapter                       *adapters.MySQL
	usersRecognitionConfiguration *UserRecognitionConfiguration
}

func init() {
	RegisterStorage(StorageType{typeName: MySQLType, createFunc: NewMySQL, isSQL: true})
}

//NewMySQL returns configured MySQL Destination
func NewMySQL(config *Config) (storage Storage, err error) {
	defer func() {
		if err != nil && storage != nil {
			storage.Close()
			storage = nil
		}
	}()
	mConfig := &adapters.DataSourceConfig{}
	if err = config.destination.GetDestConfig(config.destination.DataSource, mConfig); err != nil {
		return
	}
	//enrich with default parameters
	if mConfig.Port == 0 {
		mConfig.Port = 3306
		logging.Warnf("[%s] port wasn't provided. Will be used default one: %d", config.destinationID, mConfig.Port)
	}
	//schema and database are synonyms in MySQL
	//default connect timeout seconds
	if _, ok := mConfig.Parameters["timeout"]; !ok {
		mConfig.Parameters["timeout"] = "600s"
	}
	m := &MySQL{}
	err = m.Init(config, m, "", "")
	if err != nil {
		return
	}
	storage = m

	queryLogger := config.loggerFactory.CreateSQLQueryLogger(config.destinationID)
	ctx := context.WithValue(config.ctx, adapters.CtxDestinationId, config.destinationID)
	adapter, err := CreateMySQLAdapter(ctx, *mConfig, queryLogger, m.sqlTypes)
	if err != nil {
		return
	}

	tableHelper := NewTableHelper(mConfig.Schema, adapter, config.coordinationService, config.pkFields, adapters.SchemaToMySQL, config.maxColumns, MySQLType)

	m.adapter = adapter
	m.usersRecognitionConfiguration = config.usersRecognition

	//Abstract
	m.tableHelpers = []*TableHelper{tableHelper}
	m.sqlAdapters = []adapters.SQLAdapter{adapter}

	//streaming worker (queue reading)
	m.streamingWorker = newStreamingWorker(config.eventQueue, m, tableHelper)
	return
}

//CreateMySQLAdapter creates mysql adapter with database
//if database doesn't exist - mysql returns error. In this case connect without database and create it
func CreateMySQLAdapter(ctx context.Context, config adapters.DataSourceConfig, queryLogger *logging.QueryLogger, sqlTypes typing.SQLTypes) (*adapters.MySQL, error) {
	mySQLAdapter, err := adapters.NewMySQL(ctx, &config, queryLogger, sqlTypes)
	if err != nil {
		if mErr, ok := err.(*mysql.MySQLError); ok {
			//db doesn't exist
			if mErr.Number == 1049 {
				mySQLDB := config.Db
				config.Db = ""
				//create adapter without a certain DB
				tmpMySQLAdapter, err := adapters.NewMySQL(ctx, &config, queryLogger, sqlTypes)
				if err != nil {
					return nil, err
				}
				defer tmpMySQLAdapter.Close()

				config.Db = mySQLDB
				//create DB and reconnect
				if err = tmpMySQLAdapter.CreateDB(config.Db); err != nil {
					return nil, err
				}

				//create adapter with a certain DB
				mySQLAdapterWithDB, err := adapters.NewMySQL(ctx, &config, queryLogger, sqlTypes)
				if err != nil {
					return nil, err
				}
				return mySQLAdapterWithDB, nil
			}
		}
		return nil, err
	}

	return mySQLAdapter, nil
}

func (m *MySQL) DryRun(payload events.Event) ([][]adapters.TableField, error) {
	_, tableHelper := m.getAdapters()
	return dryRun(payload, m.processor, tableHelper)
}

//SyncStore is used in storing chunk of pulled data to Postgres with processing
func (m *MySQL) SyncStore(overriddenDataSchema *schema.BatchHeader, objects []map[string]interface{}, deleteConditions *adapters.DeleteConditions, cacheTable bool, needCopyEvent bool) error {
	return syncStoreImpl(m, overriddenDataSchema, objects, deleteConditions, cacheTable, needCopyEvent)
}

func (m *MySQL) Clean(tableName string) error {
	return cleanImpl(m, tableName)
}

//GetUsersRecognition returns users recognition configuration
func (m *MySQL) GetUsersRecognition() *UserRecognitionConfiguration {
	return m.usersRecognitionConfiguration
}

//Type returns MySQL type
func (m *MySQL) Type() string {
	return MySQLType
}

//Close closes MySQL adapter, fallback logger and streaming worker
func (m *MySQL) Close() (multiErr error) {
	if m.streamingWorker != nil {
		if err := m.streamingWorker.Close(); err != nil {
			multiErr = multierror.Append(multiErr, fmt.Errorf("[%s] Error closing streaming worker: %v", m.ID(), err))
		}
	}

	if m.adapter != nil {
		if err := m.adapter.Close(); err != nil {
			multiErr = multierror.Append(multiErr, fmt.Errorf("[%s] Error closing postgres datasource: %v", m.ID(), err))
		}
	}

	if err := m.close(); err != nil {
		multiErr = multierror.Append(multiErr, err)
	}

	return
}
