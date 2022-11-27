package storages

import (
	"errors"
	"fmt"
	"github.com/jitsucom/jitsu/server/coordination"
	"github.com/jitsucom/jitsu/server/locks"
	"sync"
	"time"

	"github.com/jitsucom/jitsu/server/adapters"
	"github.com/jitsucom/jitsu/server/logging"
	"github.com/jitsucom/jitsu/server/notifications"
	"github.com/jitsucom/jitsu/server/schema"
	"github.com/jitsucom/jitsu/server/typing"
)

const tableLockTimeout = time.Minute

// TableHelper keeps tables schema state inmemory and update it according to incoming new data
// consider that all tables are in one destination schema.
// note: Assume that after any outer changes in db we need to increment table version in Service
type TableHelper struct {
	sync.RWMutex

	sqlAdapter          adapters.SQLAdapter
	coordinationService *coordination.Service
	tables              map[string]*adapters.Table

	pkFields           map[string]bool
	columnTypesMapping map[typing.DataType]string

	dbSchema        string
	destinationType string
	streamMode      bool
	maxColumns      int
}

// NewTableHelper returns configured TableHelper instance
// Note: columnTypesMapping must be not empty (or fields will be ignored)
func NewTableHelper(dbSchema string, sqlAdapter adapters.SQLAdapter, coordinationService *coordination.Service, pkFields map[string]bool,
	columnTypesMapping map[typing.DataType]string, maxColumns int, destinationType string) *TableHelper {

	return &TableHelper{
		sqlAdapter:          sqlAdapter,
		coordinationService: coordinationService,
		tables:              map[string]*adapters.Table{},

		pkFields:           pkFields,
		columnTypesMapping: columnTypesMapping,

		dbSchema:        dbSchema,
		destinationType: destinationType,
		maxColumns:      maxColumns,
	}
}

// MapTableSchema maps schema.BatchHeader (JSON structure with json data types) into adapters.Table (structure with SQL types)
// applies column types mapping
func (th *TableHelper) MapTableSchema(batchHeader *schema.BatchHeader) *adapters.Table {
	table := &adapters.Table{
		Schema:    th.dbSchema,
		Name:      batchHeader.TableName,
		Columns:   adapters.Columns{},
		Partition: batchHeader.Partition,
		PKFields:  th.pkFields,
	}

	//pk fields from the configuration
	if len(th.pkFields) > 0 {
		table.PrimaryKeyName = adapters.BuildConstraintName(table.Schema, table.Name)
	}

	for fieldName, field := range batchHeader.Fields {
		suggestedSQLType, ok := field.GetSuggestedSQLType(th.destinationType)
		if ok {
			table.Columns[fieldName] = suggestedSQLType
			continue
		}

		//map Jitsu type -> SQL type
		sqlType, ok := th.columnTypesMapping[field.GetType()]
		if ok {
			table.Columns[fieldName] = typing.SQLColumn{Type: sqlType}
		} else {
			logging.SystemErrorf("Unknown column type mapping for %s mapping: %v", field.GetType(), th.columnTypesMapping)
		}
	}

	return table
}

// EnsureTableWithCaching calls EnsureTable with cacheTable = true
// it is used in stream destinations (because we don't have time to select table schema, but there is retry on error)
func (th *TableHelper) EnsureTableWithCaching(destinationID string, dataSchema *adapters.Table) (*adapters.Table, error) {
	return th.EnsureTable(destinationID, dataSchema, true)
}

// EnsureTableWithoutCaching calls EnsureTable with cacheTable = true
// it is used in batch destinations and syncStore (because we have time to select table schema)
func (th *TableHelper) EnsureTableWithoutCaching(destinationID string, dataSchema *adapters.Table) (*adapters.Table, error) {
	return th.EnsureTable(destinationID, dataSchema, false)
}

// EnsureTable returns DB table schema and err if occurred
// if table doesn't exist - create a new one and increment version
// if exists - calculate diff, patch existing one with diff and increment version
// returns actual db table schema (with actual db types)
func (th *TableHelper) EnsureTable(destinationID string, dataSchema *adapters.Table, cacheTable bool) (*adapters.Table, error) {
	th.Lock()
	defer th.Unlock()
	var dbSchema *adapters.Table
	var err error

	if cacheTable {
		dbSchema, err = th.getCachedTableSchema(destinationID, dataSchema)
	} else {
		dbSchema, err = th.getOrCreateWithLock(destinationID, dataSchema)
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
	//patch table schema
	return th.patchTableWithLock(destinationID, dataSchema)
}

// patchTable locks table, get from DWH and patch
func (th *TableHelper) patchTableWithLock(destinationID string, dataSchema *adapters.Table) (*adapters.Table, error) {
	tableIdentifier := th.getTableIdentifier(destinationID, dataSchema.Name)
	tableLock, err := th.lockTable(destinationID, dataSchema.Name, tableIdentifier)
	if err != nil {
		return nil, err
	}
	defer tableLock.Unlock()

	dbSchema, err := th.getOrCreate(dataSchema)
	if err != nil {
		return nil, err
	}

	//handle table schema local changes (patching was in another goroutine)
	diff := dbSchema.Diff(dataSchema)
	if !diff.Exists() {
		return dbSchema, nil
	}

	if err := th.sqlAdapter.PatchTableSchema(diff); err != nil {
		return nil, err
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

	// Save data schema to local cache
	th.tables[dbSchema.Name] = dbSchema

	return dbSchema.Clone(), nil
}

func (th *TableHelper) getCachedTableSchema(destinationName string, dataSchema *adapters.Table) (*adapters.Table, error) {
	dbSchema, ok := th.tables[dataSchema.Name]

	if ok {
		return dbSchema.Clone(), nil
	}

	// Get data schema from DWH or create
	dbSchema, err := th.getOrCreateWithLock(destinationName, dataSchema)
	if err != nil {
		return nil, err
	}

	// Save data schema to local cache
	th.tables[dbSchema.Name] = dbSchema

	return dbSchema.Clone(), nil
}

// RefreshTableSchema force get (or create) db table schema and update it in-memory
func (th *TableHelper) RefreshTableSchema(destinationName string, dataSchema *adapters.Table) (*adapters.Table, error) {
	th.Lock()
	defer th.Unlock()
	dbTableSchema, err := th.getOrCreateWithLock(destinationName, dataSchema)
	if err != nil {
		return nil, err
	}

	//save
	th.tables[dbTableSchema.Name] = dbTableSchema

	return dbTableSchema, nil
}

// lock table -> get existing schema -> create a new one if doesn't exist -> return schema with version
func (th *TableHelper) getOrCreateWithLock(destinationID string, dataSchema *adapters.Table) (*adapters.Table, error) {
	tableIdentifier := th.getTableIdentifier(destinationID, dataSchema.Name)
	tableLock, err := th.lockTable(destinationID, dataSchema.Name, tableIdentifier)
	if err != nil {
		return nil, err
	}
	defer tableLock.Unlock()

	return th.getOrCreate(dataSchema)
}

func (th *TableHelper) getOrCreate(dataSchema *adapters.Table) (*adapters.Table, error) {
	//Get schema
	dbTableSchema, err := th.sqlAdapter.GetTableSchema(dataSchema.Name)
	if err != nil {
		return nil, err
	}

	//create new
	if !dbTableSchema.Exists() {
		if err := th.sqlAdapter.CreateTable(dataSchema); err != nil {
			return nil, err
		}

		dbTableSchema.Schema = dataSchema.Schema
		dbTableSchema.Name = dataSchema.Name
		dbTableSchema.Columns = dataSchema.Columns
		dbTableSchema.PKFields = dataSchema.PKFields
		dbTableSchema.PrimaryKeyName = dataSchema.PrimaryKeyName
	}

	return dbTableSchema, nil
}

func (th *TableHelper) lockTable(destinationID, tableName, tableIdentifier string) (locks.Lock, error) {
	tableLock := th.coordinationService.CreateLock(tableIdentifier)
	locked, err := tableLock.TryLock(tableLockTimeout)
	if err != nil {
		msg := fmt.Sprintf("System error: Unable to lock destination [%s] table %s: %v", destinationID, tableName, err)
		notifications.SystemError(msg)
		return nil, errors.New(msg)
	}

	if !locked {
		return nil, fmt.Errorf("unable to lock table %s. Table has been already locked: timeout after %s", tableIdentifier, tableLockTimeout.String())
	}

	return tableLock, nil
}

func (th *TableHelper) getTableIdentifier(destinationID, tableName string) string {
	return destinationID + "_" + tableName
}
