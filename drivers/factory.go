package drivers

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"github.com/jitsucom/eventnative/logging"
	"github.com/jitsucom/eventnative/timestamp"
	"github.com/spf13/cast"
	"time"
)

var (
	unknownSource      = errors.New("Unknown source type")
	driverConstructors = make(map[string]func(ctx context.Context, config *SourceConfig, collection *Collection) (Driver, error))
)

const (
	collectionNameField       = "name"
	collectionTableNameField  = "table_name"
	collectionParametersField = "parameters"

	defaultSingerCollection = "all"
)

type SourceConfig struct {
	Name      string     //without serialization
	StartDate *time.Time //without serialization

	Type         string        `mapstructure:"type" json:"type,omitempty" yaml:"type,omitempty"`
	Destinations []string      `mapstructure:"destinations" json:"destinations,omitempty" yaml:"destinations,omitempty"`
	Collections  []interface{} `mapstructure:"collections" json:"collections,omitempty" yaml:"collections,omitempty"`
	StartDateStr string        `mapstructure:"start_date" json:"start_date,omitempty" yaml:"start_date,omitempty"`

	Config map[string]interface{} `mapstructure:"config" json:"config,omitempty" yaml:"config,omitempty"`
}

type Collection struct {
	Name       string                 `mapstructure:"name" json:"name,omitempty" yaml:"name,omitempty"`
	Type       string                 `mapstructure:"type" json:"type,omitempty" yaml:"type,omitempty"`
	TableName  string                 `mapstructure:"table_name" json:"table_name,omitempty" yaml:"table_name,omitempty"`
	Parameters map[string]interface{} `mapstructure:"parameters" json:"parameters,omitempty" yaml:"parameters,omitempty"`
}

func (c Collection) GetTableName() string {
	if c.TableName != "" {
		return c.TableName
	}
	return c.Name
}

//RegisterDriverConstructor registers function to create new driver instance per driver type
func RegisterDriverConstructor(driverType string,
	createDriverFunc func(ctx context.Context, config *SourceConfig, collection *Collection) (Driver, error)) error {
	driverConstructors[driverType] = createDriverFunc
	return nil
}

//Create source drivers per collection
//Enrich incoming configs with default values if needed
func Create(ctx context.Context, name string, sourceConfig *SourceConfig) (map[string]Driver, error) {
	if sourceConfig.Type == "" {
		sourceConfig.Type = name
	}

	sourceConfig.Name = name

	collections, err := parseCollections(sourceConfig)
	if err != nil {
		return nil, err
	}

	logging.Infof("[%s] Initializing source of type: %s", name, sourceConfig.Type)
	if len(collections) == 0 {
		return nil, errors.New("collections are empty. Please specify at least one collection")
	}
	if len(sourceConfig.Destinations) == 0 {
		return nil, errors.New("destinations are empty. Please specify at least one destination")
	}

	if sourceConfig.StartDateStr != "" {
		startDate, err := time.Parse(timestamp.DashDayLayout, sourceConfig.StartDateStr)
		if err != nil {
			return nil, fmt.Errorf("Malformed start_date: please use YYYY-MM-DD format: %v", err)
		}

		date := time.Date(startDate.Year(), startDate.Month(), startDate.Day(), 0, 0, 0, 0, time.UTC)
		sourceConfig.StartDate = &date
		logging.Infof("[%s] Using start date: %s", name, date)
	}

	driverPerCollection := map[string]Driver{}

	createDriverFunc, ok := driverConstructors[sourceConfig.Type]
	if !ok {
		return nil, unknownSource
	}
	for _, collection := range collections {
		driver, err := createDriverFunc(ctx, sourceConfig, collection)
		if err != nil {
			return nil, fmt.Errorf("error creating [%s] driver for [%s] collection: %v", sourceConfig.Type, collection.Name, err)
		}
		driverPerCollection[collection.Name] = driver
	}
	return driverPerCollection, nil
}

//return serialized Collection objects slice
//or return one default collection if singer type
func parseCollections(sourceConfig *SourceConfig) ([]*Collection, error) {
	if sourceConfig.Type == SingerType {
		return []*Collection{{Name: defaultSingerCollection}}, nil
	}

	var collections []*Collection
	for _, collection := range sourceConfig.Collections {
		switch collection.(type) {
		case string:
			collections = append(collections, &Collection{Name: collection.(string), Type: collection.(string)})
		case map[interface{}]interface{}:
			collectionConfigMap := cast.ToStringMap(collection)
			collectionName := getStringParameter(collectionConfigMap, collectionNameField)
			if collectionName == "" {
				return nil, errors.New("[name] field of collection is not configured")
			}
			collectionType := getStringParameter(collectionConfigMap, "type")
			if collectionType == "" {
				collectionType = collectionName
			}
			collection := Collection{Name: collectionName, Type: collectionType,
				TableName:  getStringParameter(collectionConfigMap, collectionTableNameField),
				Parameters: cast.ToStringMap(collectionConfigMap[collectionParametersField])}
			collections = append(collections, &collection)
		default:
			return nil, errors.New("failed to parse source collections as array of string or collections structure")
		}
	}

	return collections, nil
}

func getStringParameter(dict map[string]interface{}, parameterName string) string {
	value, ok := dict[parameterName]
	if !ok {
		return ""
	}
	str, ok := value.(string)
	if ok {
		return str
	}
	return ""
}

func unmarshalConfig(config map[string]interface{}, object interface{}) error {
	b, err := json.Marshal(config)
	if err != nil {
		return fmt.Errorf("Error marshalling config: %v", err)
	}
	err = json.Unmarshal(b, object)
	if err != nil {
		return fmt.Errorf("Error unmarshalling config: %v", err)
	}

	return nil
}

//return difference between now and t in DAYS + 1 (current day)
//e.g. 2021-03-01 - 2021-03-01 = 0, but we should load current date as well
func getDaysBackToLoad(t *time.Time) int {
	now := time.Now().UTC()
	currentDay := time.Date(now.Year(), now.Month(), now.Day(), 0, 0, 0, 0, now.Location())
	return int(currentDay.Sub(*t).Hours()/24) + 1
}
