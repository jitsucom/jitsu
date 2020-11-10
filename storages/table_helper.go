package storages

import (
	"errors"
	"fmt"
	"github.com/jitsucom/eventnative/adapters"
	"github.com/jitsucom/eventnative/notifications"
	"github.com/jitsucom/eventnative/schema"
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
func (th *TableHelper) EnsureTable(destinationName string, dataSchema *schema.Table) (*schema.Table, error) {
	var err error
	dbTableSchema, ok := th.tables[dataSchema.Name]

	//get or create
	if !ok {
		dbTableSchema, err = th.getOrCreate(destinationName, dataSchema)
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
	pkPatch := schema.NewPkFieldsPatch(dbTableSchema, dataSchema)

	//if diff doesn't exist - do nothing
	if !schemaDiff.Exists() && !pkPatch.Exists() {
		return dbTableSchema, nil
	}

	//patch schema
	lock, err := th.monitorKeeper.Lock(destinationName, dbTableSchema.Name)
	if err != nil {
		msg := fmt.Sprintf("System error: Unable to lock table %s in %s: %v", dataSchema.Name, th.storageType, err)
		notifications.SystemError(msg)
		return nil, errors.New(msg)
	}
	defer th.monitorKeeper.Unlock(lock)

	ver, err := th.monitorKeeper.GetVersion(destinationName, dbTableSchema.Name)
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
		pkPatch = schema.NewPkFieldsPatch(dbTableSchema, dataSchema)
	}

	//check if newSchemaDiff doesn't exist - do nothing
	if !schemaDiff.Exists() && !pkPatch.Exists() {
		return dbTableSchema, nil
	}

	//patch and increment table version
	if schemaDiff.Exists() {
		if err := th.manager.PatchTableSchema(schemaDiff); err != nil {
			return nil, err
		}

		newVersion, err := th.monitorKeeper.IncrementVersion(destinationName, dbTableSchema.Name)
		if err != nil {
			return nil, fmt.Errorf("Error incrementing version in storage [%s]: %v", th.storageType, err)
		}

		//Save
		for k, v := range schemaDiff.Columns {
			dbTableSchema.Columns[k] = v
		}
		dbTableSchema.Version = newVersion
	}

	if pkPatch.Exists() {
		if err := th.manager.UpdatePrimaryKey(dbTableSchema, pkPatch); err != nil {
			return nil, fmt.Errorf("Failed to update primary key for [%s]: %v", th.storageType, err)
		}
		newVersion, err := th.monitorKeeper.IncrementVersion(destinationName, dbTableSchema.Name)
		if err != nil {
			return nil, fmt.Errorf("Error incrementing version in storage [%s]: %v", th.storageType, err)
		}
		dbTableSchema.PKFields = pkPatch.PKFields
		dbTableSchema.Version = newVersion
	}

	return dbTableSchema, nil
}

//lock table -> get existing schema -> create a new one if doesn't exist -> return schema with version
func (th *TableHelper) getOrCreate(destinationName string, dataSchema *schema.Table) (*schema.Table, error) {
	lock, err := th.monitorKeeper.Lock(destinationName, dataSchema.Name)
	if err != nil {
		msg := fmt.Sprintf("System error: Unable to lock table %s in %s: %v", dataSchema.Name, th.storageType, err)
		notifications.SystemError(msg)
		return nil, errors.New(msg)
	}
	defer th.monitorKeeper.Unlock(lock)

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

		ver, err := th.monitorKeeper.IncrementVersion(destinationName, dataSchema.Name)
		if err != nil {
			return nil, fmt.Errorf("Error incrementing version of table %s in %s: %v", dataSchema.Name, th.storageType, err)
		}

		dbTableSchema.Name = dataSchema.Name
		dbTableSchema.Columns = dataSchema.Columns
		dbTableSchema.Version = ver
		// Setting primary key fields as empty to initialize at EnsureTable() later
		dbTableSchema.PKFields = map[string]bool{}
	} else {
		ver, err := th.monitorKeeper.GetVersion(destinationName, dbTableSchema.Name)
		if err != nil {
			return nil, fmt.Errorf("Error getting version of table %s in %s: %v", dataSchema.Name, th.storageType, err)
		}

		dbTableSchema.Version = ver
	}

	return dbTableSchema, nil
}
