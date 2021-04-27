package storages

import (
	"errors"
	"fmt"
	"sync"

	"github.com/jitsucom/jitsu/server/adapters"
	"github.com/jitsucom/jitsu/server/logging"
	"github.com/jitsucom/jitsu/server/notifications"
	"github.com/jitsucom/jitsu/server/schema"
	"github.com/jitsucom/jitsu/server/typing"
)

const unlockRetryCount = 5

//Keeping tables schema state inmemory and update it according to incoming new data
//note: Assume that after any outer changes in db we need to increment table version in MonitorKeeper
type TableHelper struct {
	sync.RWMutex

	manager       adapters.TableManager
	monitorKeeper MonitorKeeper
	tables        map[string]*adapters.Table

	pkFields           map[string]bool
	columnTypesMapping map[typing.DataType]string

	streamMode bool
	maxColumns int
}

func NewTableHelper(manager adapters.TableManager, monitorKeeper MonitorKeeper, pkFields map[string]bool,
	columnTypesMapping map[typing.DataType]string, streamMode bool, maxColumns int) *TableHelper {

	return &TableHelper{
		manager:       manager,
		monitorKeeper: monitorKeeper,
		tables:        map[string]*adapters.Table{},

		pkFields:           pkFields,
		columnTypesMapping: columnTypesMapping,

		streamMode: streamMode,
		maxColumns: maxColumns,
	}
}

func (th *TableHelper) MapTableSchema(batchHeader *schema.BatchHeader) *adapters.Table {
	table := &adapters.Table{
		Name:     batchHeader.TableName,
		Columns:  adapters.Columns{},
		PKFields: th.pkFields,
		Version:  0,
	}

	for fieldName, field := range batchHeader.Fields {
		//map storage type
		sqlType, ok := th.columnTypesMapping[field.GetType()]
		if ok {
			table.Columns[fieldName] = adapters.Column{SQLType: sqlType}
		} else {
			logging.SystemErrorf("Unknown column type mapping for %s mapping: %v", field.GetType(), th.columnTypesMapping)
		}
	}

	return table
}

//EnsureTable return DB table schema and err if occurred
//if table doesn't exist - create a new one and increment version
//if exists - calculate diff, patch existing one with diff and increment version
//return actual db table schema (with actual db types)
func (th *TableHelper) EnsureTable(destinationID string, dataSchema *adapters.Table) (*adapters.Table, error) {
	var dbSchema *adapters.Table
	var err error

	if th.streamMode {
		dbSchema, err = th.getSavedTableSchema(destinationID, dataSchema)
	} else {
		dbSchema, err = th.getOrCreate(destinationID, dataSchema)
	}
	if err != nil {
		return nil, err
	}

	//if diff doesn't exist - do nothing
	diff := dbSchema.Diff(dataSchema)
	if !diff.Exists() {
		return dbSchema, nil
	}

	//check if max columns error
	if th.maxColumns > 0 {
		columnsCount := len(dbSchema.Columns) + len(diff.Columns)
		if columnsCount > th.maxColumns {
			//return nil, fmt.Errorf("Count of columns %d should be less or equal 'server.max_columns' (or destination.data_layout.max_columns) setting %d", columnsCount, th.maxColumns)
			logging.Warnf("[%s] Count of columns %d should be less or equal 'server.max_columns' (or destination.data_layout.max_columns) setting %d", destinationID, columnsCount, th.maxColumns)
		}
	}

	//** Diff exists **
	//patch schema
	lock, err := th.monitorKeeper.Lock(destinationID, dbSchema.Name)
	if err != nil {
		msg := fmt.Sprintf("System error: Unable to lock table %s: %v", dbSchema.Name, err)
		notifications.SystemError(msg)
		return nil, errors.New(msg)
	}
	defer th.monitorKeeper.Unlock(lock)

	//handle schema local changes (patching was in another goroutine)
	diff = dbSchema.Diff(dataSchema)
	if !diff.Exists() {
		return dbSchema, nil
	}

	//handle schema remote changes (in multi-cluster setup)
	ver, err := th.monitorKeeper.GetVersion(destinationID, dbSchema.Name)
	if err != nil {
		return nil, fmt.Errorf("Error getting table %s version: %v", dataSchema.Name, err)
	}

	//get schema and calculate diff one more time if version was changed (this statement handles optimistic locking)
	if ver != dbSchema.Version {
		dbSchema, err = th.manager.GetTableSchema(dbSchema.Name)
		if err != nil {
			return nil, fmt.Errorf("Error getting table %s schema: %v", dataSchema.Name, err)
		}

		dbSchema.Version = ver

		diff = dbSchema.Diff(dataSchema)
	}

	//check if newSchemaDiff doesn't exist - do nothing
	if !diff.Exists() {
		return dbSchema, nil
	}

	if err := th.manager.PatchTableSchema(diff); err != nil {
		return nil, err
	}

	newVersion, err := th.monitorKeeper.IncrementVersion(destinationID, diff.Name)
	if err != nil {
		return nil, fmt.Errorf("Error incrementing table %s version: %v", diff.Name, err)
	}

	//** Save **
	//columns
	for k, v := range diff.Columns {
		dbSchema.Columns[k] = v
	}
	//pk fields
	if len(diff.PKFields) > 0 {
		dbSchema.PKFields = diff.PKFields
	}
	//remove pk fields if a deletion was
	if diff.DeletePkFields {
		dbSchema.PKFields = map[string]bool{}
	}
	//version
	dbSchema.Version = newVersion

	return dbSchema, nil
}

func (th *TableHelper) getSavedTableSchema(destinationName string, dataSchema *adapters.Table) (*adapters.Table, error) {
	th.RLock()
	dbSchema, ok := th.tables[dataSchema.Name]
	th.RUnlock()

	if ok {
		return dbSchema, nil
	}

	// Get data schema from DWH or create
	dbSchema, err := th.getOrCreate(destinationName, dataSchema)
	if err != nil {
		return nil, err
	}

	// Save data schema to local cache
	th.Lock()
	th.tables[dbSchema.Name] = dbSchema
	th.Unlock()

	return dbSchema, nil
}

//RefreshTableSchema force get (or create) db table schema and update it in-memory
func (th *TableHelper) RefreshTableSchema(destinationName string, dataSchema *adapters.Table) (*adapters.Table, error) {
	dbTableSchema, err := th.getOrCreate(destinationName, dataSchema)
	if err != nil {
		return nil, err
	}

	//save
	th.Lock()
	th.tables[dbTableSchema.Name] = dbTableSchema
	th.Unlock()

	return dbTableSchema, nil
}

//lock table -> get existing schema -> create a new one if doesn't exist -> return schema with version
func (th *TableHelper) getOrCreate(destinationName string, dataSchema *adapters.Table) (*adapters.Table, error) {
	lock, err := th.monitorKeeper.Lock(destinationName, dataSchema.Name)
	if err != nil {
		msg := fmt.Sprintf("System error: Unable to lock table %s: %v", dataSchema.Name, err)
		notifications.SystemError(msg)
		return nil, errors.New(msg)
	}
	defer th.monitorKeeper.Unlock(lock)

	//Get schema
	dbTableSchema, err := th.manager.GetTableSchema(dataSchema.Name)
	if err != nil {
		return nil, fmt.Errorf("Error getting table %s schema: %v", dataSchema.Name, err)
	}

	//create new or get version
	if !dbTableSchema.Exists() {
		if err := th.manager.CreateTable(dataSchema); err != nil {
			return nil, fmt.Errorf("Error creating table %s: %v", dataSchema.Name, err)
		}

		ver, err := th.monitorKeeper.IncrementVersion(destinationName, dataSchema.Name)
		if err != nil {
			return nil, fmt.Errorf("Error incrementing table %s version: %v", dataSchema.Name, err)
		}

		dbTableSchema.Name = dataSchema.Name
		dbTableSchema.Columns = dataSchema.Columns
		dbTableSchema.Version = ver
		dbTableSchema.PKFields = dataSchema.PKFields
	} else {
		ver, err := th.monitorKeeper.GetVersion(destinationName, dbTableSchema.Name)
		if err != nil {
			return nil, fmt.Errorf("Error getting table %s version: %v", dataSchema.Name, err)
		}

		dbTableSchema.Version = ver
	}

	return dbTableSchema, nil
}
