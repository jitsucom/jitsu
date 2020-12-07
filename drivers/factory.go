package drivers

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"github.com/jitsucom/eventnative/logging"
	"github.com/spf13/cast"
)

var unknownSource = errors.New("Unknown source type")

const (
	collectionNameField       = "name"
	collectionTableNameField  = "table_name"
	collectionParametersField = "parameters"
)

type SourceConfig struct {
	Type         string        `mapstructure:"type" json:"type,omitempty" yaml:"type,omitempty"`
	Destinations []string      `mapstructure:"destinations" json:"destinations,omitempty" yaml:"destinations,omitempty"`
	Collections  []interface{} `mapstructure:"collections" json:"collections,omitempty" yaml:"collections,omitempty"`

	Config map[string]interface{} `mapstructure:"config" json:"config,omitempty" yaml:"config,omitempty"`
}

type Collection struct {
	Name       string                 `mapstructure:"name" json:"name,omitempty" yaml:"name,omitempty"`
	Type       string                 `mapstructure:"type" json:"type,omitempty" yaml:"type,omitempty"`
	TableName  string                 `mapstructure:"table_name" json:"table_name,omitempty" yaml:"table_name,omitempty"`
	Parameters map[string]interface{} `mapstructure:"parameters" json:"parameters,omitempty" yaml:"parameters,omitempty"`
}

//Create source drivers per collection
//Enrich incoming configs with default values if needed
func Create(ctx context.Context, name string, sourceConfig *SourceConfig) (map[string]Driver, error) {
	if sourceConfig.Type == "" {
		sourceConfig.Type = name
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

	logging.Infof("[%s] Initializing source of type: %s", name, sourceConfig.Type)
	if len(collections) == 0 {
		return nil, errors.New("collections are empty. Please specify at least one collection")
	}
	if len(sourceConfig.Destinations) == 0 {
		return nil, errors.New("destinations are empty. Please specify at least one destination")
	}

	driverPerCollection := map[string]Driver{}

	switch sourceConfig.Type {
	case GooglePlayType:
		gpCfg := &GooglePlayConfig{}
		err := unmarshalConfig(sourceConfig.Config, gpCfg)
		if err != nil {
			return nil, err
		}
		if err := gpCfg.Validate(); err != nil {
			return nil, err
		}

		for _, collection := range collections {
			gpd, err := NewGooglePlay(ctx, gpCfg, collection)
			if err != nil {
				return nil, fmt.Errorf("error creating [%s] driver for [%s] collection: %v", sourceConfig.Type, collection, err)
			}
			driverPerCollection[collection.Name] = gpd
		}
		return driverPerCollection, nil
	case FirebaseType:
		firebaseCfg := &FirebaseConfig{}
		err := unmarshalConfig(sourceConfig.Config, firebaseCfg)
		if err != nil {
			return nil, err
		}
		if err := firebaseCfg.Validate(); err != nil {
			return nil, err
		}
		for _, collection := range collections {
			firebase, err := NewFirebase(ctx, firebaseCfg, collection)
			if err != nil {
				return nil, fmt.Errorf("error creating [%s] driver for [%s] collection: %v", sourceConfig.Type, collection, err)
			}
			driverPerCollection[collection.Name] = firebase
		}
		return driverPerCollection, nil
	case GoogleAnalyticsType:
		gaConfig := &GoogleAnalyticsConfig{}
		err := unmarshalConfig(sourceConfig.Config, gaConfig)
		if err != nil {
			return nil, err
		}
		if err := gaConfig.Validate(); err != nil {
			return nil, err
		}
		for _, collection := range collections {
			ga, err := NewGoogleAnalytics(ctx, gaConfig, collection)
			if err != nil {
				return nil, fmt.Errorf("error creating [%s] driver for [%s] collection: %v", sourceConfig.Type, collection, err)
			}
			driverPerCollection[collection.Name] = ga
		}
		return driverPerCollection, nil
	default:
		return nil, unknownSource
	}
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
