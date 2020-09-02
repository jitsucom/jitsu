package storages

import (
	"fmt"
	"github.com/ksensehq/eventnative/adapters"
	"github.com/ksensehq/eventnative/schema"
	"log"
)

const unlockRetryCount = 5

//Keeping tables schema state inmemory and update it according to incoming new data
//note: Assume that after any outer changes in db we need to increment table version in MonitorKeeper
type TableHelper struct {
	manager       adapters.TableManager
	monitorKeeper MonitorKeeper
	tables        map[string]*schema.Table
	storageType   string
}

func NewTableHelper(manager adapters.TableManager, monitorKeeper MonitorKeeper, storageType string) *TableHelper {
	return &TableHelper{
		manager:       manager,
		monitorKeeper: monitorKeeper,
		tables:        map[string]*schema.Table{},
		storageType:   storageType,
	}
}

//EnsureTable return DB table schema and err if occurred
//if table doesn't exist - create a new one and increment version
//if exists - calculate diff, patch existing one with diff and increment version
//return actual db table schema (with actual db types)
func (th *TableHelper) EnsureTable(dataSchema *schema.Table) (*schema.Table, error) {
	var err error
	dbTableSchema, ok := th.tables[dataSchema.Name]

	//get or create
	if !ok {
		dbTableSchema, err = th.getOrCreate(dataSchema)
		if err != nil {
			return nil, err
		}

		//save
		th.tables[dbTableSchema.Name] = dbTableSchema
	}

	schemaDiff, err := dbTableSchema.Diff(dataSchema)
	if err != nil {
		return nil, err
	}

	//if diff doesn't exist - do nothing
	if !schemaDiff.Exists() {
		return dbTableSchema, nil
	}

	//patch schema
	if err := th.monitorKeeper.Lock(th.storageType, dbTableSchema.Name); err != nil {
		return nil, fmt.Errorf("System error locking table %s in %s: %v", dataSchema.Name, th.storageType, err)
	}
	defer th.unlock(dbTableSchema.Name, 1)

	ver, err := th.monitorKeeper.GetVersion(th.storageType, dbTableSchema.Name)
	if err != nil {
		return nil, fmt.Errorf("Error getting version of table %s in %s: %v", dataSchema.Name, th.storageType, err)
	}

	//get schema and calculate diff one more time if version was changed (this statement handles optimistic locking)
	if ver != dbTableSchema.Version {
		dbTableSchema, err = th.manager.GetTableSchema(dataSchema.Name)
		if err != nil {
			return nil, fmt.Errorf("Error getting table %s schema from %s: %v", dataSchema.Name, th.storageType, err)
		}

		dbTableSchema.Version = ver

		schemaDiff, err = dbTableSchema.Diff(dataSchema)
		if err != nil {
			return nil, err
		}
	}

	//check if newSchemaDiff doesn't exist - do nothing
	if !schemaDiff.Exists() {
		return dbTableSchema, nil
	}

	//patch and increment table version
	if err := th.manager.PatchTableSchema(schemaDiff); err != nil {
		return nil, err
	}

	newVersion, err := th.monitorKeeper.IncrementVersion(th.storageType, dbTableSchema.Name)
	if err != nil {
		return nil, fmt.Errorf("Error incrementing version in storage [%s]: %v", th.storageType, err)
	}

	//Save
	for k, v := range schemaDiff.Columns {
		dbTableSchema.Columns[k] = v
	}
	dbTableSchema.Version = newVersion

	return dbTableSchema, nil
}

//lock table -> get existing schema -> create a new one if doesn't exist -> return schema with version
func (th *TableHelper) getOrCreate(dataSchema *schema.Table) (*schema.Table, error) {
	if err := th.monitorKeeper.Lock(th.storageType, dataSchema.Name); err != nil {
		return nil, fmt.Errorf("System error locking table %s in %s: %v", dataSchema.Name, th.storageType, err)
	}
	defer th.unlock(dataSchema.Name, 1)

	//Get schema
	dbTableSchema, err := th.manager.GetTableSchema(dataSchema.Name)
	if err != nil {
		return nil, fmt.Errorf("Error getting table %s schema from %s: %v", dataSchema.Name, th.storageType, err)
	}

	//create new or get version
	if !dbTableSchema.Exists() {
		if err := th.manager.CreateTable(dataSchema); err != nil {
			return nil, fmt.Errorf("Error creating table %s in %s: %v", dataSchema.Name, th.storageType, err)
		}

		ver, err := th.monitorKeeper.IncrementVersion(th.storageType, dataSchema.Name)
		if err != nil {
			return nil, fmt.Errorf("Error incrementing version of table %s in %s: %v", dataSchema.Name, th.storageType, err)
		}

		dbTableSchema = dataSchema
		dbTableSchema.Version = ver
	} else {
		ver, err := th.monitorKeeper.GetVersion(th.storageType, dbTableSchema.Name)
		if err != nil {
			return nil, fmt.Errorf("Error getting version of table %s in %s: %v", dataSchema.Name, th.storageType, err)
		}

		dbTableSchema.Version = ver
	}

	return dbTableSchema, nil
}

func (th *TableHelper) unlock(tableName string, retry int) {
	if err := th.monitorKeeper.Unlock(th.storageType, tableName); err != nil {
		if retry == unlockRetryCount {
			log.Printf("System error unlocking table %s in %s after %d tries: %v", tableName, th.storageType, retry, err)
		} else {
			th.unlock(tableName, retry+1)
		}
	}
}
