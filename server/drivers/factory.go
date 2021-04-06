package drivers

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"github.com/jitsucom/jitsu/server/logging"
	"github.com/jitsucom/jitsu/server/scheduling"
	"github.com/jitsucom/jitsu/server/timestamp"
	"github.com/spf13/cast"
	"time"
)

var (
	ErrUnknownSource   = errors.New("Unknown source type")
	DriverConstructors = make(map[string]func(ctx context.Context, config *SourceConfig, collection *Collection) (Driver, error))
	DriverTests        = make(map[string]func(ctx context.Context, config *SourceConfig) (Driver, error))
)

const (
	scheduleField             = "schedule"
	collectionParametersField = "parameters"

	DefaultSingerCollection = "all"

	defaultDaysBackToLoad = 365
)

type SourceConfig struct {
	Name string `mapstructure:"name" json:"name,omitempty" yaml:"name,omitempty"`

	Type         string        `mapstructure:"type" json:"type,omitempty" yaml:"type,omitempty"`
	Destinations []string      `mapstructure:"destinations" json:"destinations,omitempty" yaml:"destinations,omitempty"`
	Collections  []interface{} `mapstructure:"collections" json:"collections,omitempty" yaml:"collections,omitempty"`
	Schedule     string        `mapstructure:"schedule" json:"schedule,omitempty" yaml:"schedule,omitempty"`

	Config map[string]interface{} `mapstructure:"config" json:"config,omitempty" yaml:"config,omitempty"`
}

type Collection struct {
	DaysBackToLoad int    `json:"-"` //without serialization
	SourceID       string `json:"-"` //without serialization

	Name         string                 `mapstructure:"name" json:"name,omitempty" yaml:"name,omitempty"`
	Type         string                 `mapstructure:"type" json:"type,omitempty" yaml:"type,omitempty"`
	TableName    string                 `mapstructure:"table_name" json:"table_name,omitempty" yaml:"table_name,omitempty"`
	StartDateStr string                 `mapstructure:"start_date" json:"start_date,omitempty" yaml:"start_date,omitempty"`
	Schedule     string                 `mapstructure:"schedule" json:"schedule,omitempty" yaml:"schedule,omitempty"`
	Parameters   map[string]interface{} `mapstructure:"parameters" json:"parameters,omitempty" yaml:"parameters,omitempty"`
}

func (c *Collection) Validate() error {
	if c.Name == "" {
		return errors.New("name is required collection field")
	}

	if c.SourceID == "" {
		logging.SystemErrorf("Source ID isn't set in collection: %s of type: %s", c.Name, c.Type)
	}

	return nil
}

//GetTableName returns TableName if it's set
//otherwise SourceID_CollectionName
func (c *Collection) GetTableName() string {
	if c.TableName != "" {
		return c.TableName
	}
	return c.SourceID + "_" + c.Name
}

//RegisterDriver registers two functions per driver type:
//function to create new driver instance
//function to test driver
func RegisterDriver(driverType string,
	createDriverFunc func(ctx context.Context, config *SourceConfig, collection *Collection) (Driver, error)) error {
	DriverConstructors[driverType] = createDriverFunc
	return nil
}

//Create source drivers per collection
//Enrich incoming configs with default values if needed
func Create(ctx context.Context, name string, sourceConfig *SourceConfig, cronScheduler *scheduling.CronScheduler) (map[string]Driver, error) {
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

	for _, collection := range collections {
		if collection.StartDateStr != "" {
			startDate, err := time.Parse(timestamp.DashDayLayout, collection.StartDateStr)
			if err != nil {
				return nil, fmt.Errorf("Malformed start_date in %s collection: please use YYYY-MM-DD format: %v", collection.Name, err)
			}

			date := time.Date(startDate.Year(), startDate.Month(), startDate.Day(), 0, 0, 0, 0, time.UTC)
			collection.DaysBackToLoad = getDaysBackToLoad(&date)
			logging.Infof("[%s_%s] Using start date: %s", name, collection.Name, date)
		}
	}

	driverPerCollection := map[string]Driver{}

	createDriverFunc, ok := DriverConstructors[sourceConfig.Type]
	if !ok {
		return nil, ErrUnknownSource
	}

	for _, collection := range collections {
		driver, err := createDriverFunc(ctx, sourceConfig, collection)
		if err != nil {
			return nil, fmt.Errorf("error creating [%s] driver for [%s] collection: %v", sourceConfig.Type, collection.Name, err)
		}

		//schedule collection sync
		if collection.Schedule != "" {
			if err := cronScheduler.Schedule(name, collection.Name, collection.Schedule); err != nil {
				//close all previous drivers
				for _, alreadyCreatedDriver := range driverPerCollection {
					if closingErr := alreadyCreatedDriver.Close(); closingErr != nil {
						logging.Error(closingErr)
					}
				}

				return nil, fmt.Errorf("error scheduling sync collection [%s]: %v", collection.Name, err)
			}

			logging.Infof("[%s_%s] Using automatic scheduling: %s", name, collection.Name, collection.Schedule)
		} else {
			logging.Warnf("[%s_%s] doesn't have schedule cron expression (automatic scheduling disabled)", name, collection.Name)
		}

		driverPerCollection[collection.Name] = driver
	}
	return driverPerCollection, nil
}

//parseCollections return serialized Collection objects slice
//or return one default collection with 'schedule' if singer type
func parseCollections(sourceConfig *SourceConfig) ([]*Collection, error) {
	if sourceConfig.Type == SingerType {
		return []*Collection{{SourceID: sourceConfig.Name, Name: DefaultSingerCollection, Schedule: sourceConfig.Schedule}}, nil
	}

	var collections []*Collection
	for _, collectionI := range sourceConfig.Collections {
		switch collectionI.(type) {
		case string:
			collections = append(collections, &Collection{SourceID: sourceConfig.Name, Name: collectionI.(string), Type: collectionI.(string)})
		case map[string]interface{}, map[interface{}]interface{}:
			collectionObjMap := cast.ToStringMap(collectionI)

			parametersI, ok := collectionObjMap[collectionParametersField]
			if ok {
				parametersObjMap := cast.ToStringMap(parametersI)
				collectionObjMap[collectionParametersField] = parametersObjMap
			}

			collectionObj := &Collection{}
			if err := unmarshalConfig(collectionObjMap, collectionObj); err != nil {
				return nil, fmt.Errorf("error parsing collections: %v", err)
			}

			collectionObj.SourceID = sourceConfig.Name

			if err := collectionObj.Validate(); err != nil {
				return nil, err
			}

			collections = append(collections, collectionObj)
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
		return fmt.Errorf("error marshalling object: %v", err)
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
