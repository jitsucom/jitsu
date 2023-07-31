package base

import (
	"errors"
	"fmt"
	"github.com/jitsucom/jitsu/server/parsers"
	"path"
	"time"
)

const (
	StateFileName      = "state.json"
	ConfigFileName     = "config.json"
	CatalogFileName    = "catalog.json"
	PropertiesFileName = "properties.json"
)

//AbstractCLIDriver is an abstract implementation of CLI drivers such as Singer or Airbyte
type AbstractCLIDriver struct {
	sourceID string
	tap      string

	configPath       string
	catalogPath      string
	propertiesPath   string
	initialStatePath string

	pathToConfigs    string
	tableNamePrefix  string
	streamTableNames map[string]string
}

//NewAbstractCLIDriver returns configured AbstractCLIDriver
func NewAbstractCLIDriver(sourceID, tap, configPath, catalogPath, propertiesPath, initialStatePath, prefix, pathToConfigs string,
	tableNameMappings map[string]string) *AbstractCLIDriver {
	return &AbstractCLIDriver{
		sourceID:         sourceID,
		tap:              tap,
		configPath:       configPath,
		catalogPath:      catalogPath,
		propertiesPath:   propertiesPath,
		initialStatePath: initialStatePath,
		tableNamePrefix:  prefix,
		pathToConfigs:    pathToConfigs,
		streamTableNames: tableNameMappings,
	}
}

//ID returns sourceID
func (acd *AbstractCLIDriver) ID() string {
	return acd.sourceID
}

//GetStateFilePath returns input state as a filepath or returns initial state
func (acd *AbstractCLIDriver) GetStateFilePath(state string) (string, error) {
	//override initial state with existing one and put it to a file
	var statePath string
	var err error
	if state != "" {
		statePath, err = parsers.ParseJSONAsFile(path.Join(acd.pathToConfigs, StateFileName), state)
		if err != nil {
			return "", fmt.Errorf("Error parsing state %s: %v", state, err)
		}

		return statePath, nil
	}

	return acd.initialStatePath, nil
}

//SetCatalogPath sets catalog path
func (acd *AbstractCLIDriver) SetCatalogPath(catalogPath string) {
	acd.catalogPath = catalogPath
}

//SetPropertiesPath sets properties path
func (acd *AbstractCLIDriver) SetPropertiesPath(propertiesPath string) {
	acd.propertiesPath = propertiesPath
}

//GetCatalogPath returns catalog path
func (acd *AbstractCLIDriver) GetCatalogPath() string {
	return acd.catalogPath
}

//GetConfigPath returns config path
func (acd *AbstractCLIDriver) GetConfigPath() string {
	return acd.configPath
}

//GetPropertiesPath returns properties path
func (acd *AbstractCLIDriver) GetPropertiesPath() string {
	return acd.propertiesPath
}

//SetStreamTableNameMappingIfNotExists sets stream table name mapping if not exists
func (acd *AbstractCLIDriver) SetStreamTableNameMappingIfNotExists(streamTableNameMappings map[string]string) {
	for name, value := range streamTableNameMappings {
		if _, ok := acd.streamTableNames[name]; !ok {
			acd.streamTableNames[name] = value
		}
	}
}

//GetStreamTableNameMapping returns stream - table names mapping
func (acd *AbstractCLIDriver) GetStreamTableNameMapping() map[string]string {
	result := map[string]string{}
	for name, value := range acd.streamTableNames {
		result[name] = value
	}

	return result
}

//Ready returns CLI Driver ready flag. Should be overridden in every implementation
func (acd *AbstractCLIDriver) Ready() (bool, error) {
	return false, errors.New("Unsupported in AbstractCLIDriver")
}

//GetTableNamePrefix returns stream table name prefix or sourceID_
func (acd *AbstractCLIDriver) GetTableNamePrefix() string {
	//put as prefix + stream if prefix exist
	if acd.tableNamePrefix != "" {
		return acd.tableNamePrefix
	}

	return acd.sourceID + "_"
}

func (acd *AbstractCLIDriver) GetTap() string {
	return acd.tap
}

//GetCollectionTable unsupported
func (acd *AbstractCLIDriver) GetCollectionTable() string {
	return ""
}

func (acd *AbstractCLIDriver) GetCollectionMetaKey() string {
	return acd.tap
}

//GetRefreshWindow unsupported
func (acd *AbstractCLIDriver) GetRefreshWindow() (time.Duration, error) {
	return time.Nanosecond, fmt.Errorf("%s driver doesn't support GetRefreshWindow() func", acd.Type())
}

//GetAllAvailableIntervals unsupported
func (acd *AbstractCLIDriver) GetAllAvailableIntervals() ([]*TimeInterval, error) {
	return nil, fmt.Errorf("%s driver doesn't support GetAllAvailableIntervals() func", acd.Type())
}

//GetObjectsFor unsupported
func (acd *AbstractCLIDriver) GetObjectsFor(interval *TimeInterval, objectsLoader ObjectsLoader) error {
	return fmt.Errorf("%s driver doesn't support GetObjectsFor() func", acd.Type())
}

//Type returns CLI Driver type. Should be overridden in every implementation
func (acd *AbstractCLIDriver) Type() string {
	return "AbstractCLIDriver"
}
