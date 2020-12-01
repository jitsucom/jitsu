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

type SourceConfig struct {
	Type         string        `mapstructure:"type" json:"type,omitempty" yaml:"type,omitempty"`
	Destinations []string      `mapstructure:"destinations" json:"destinations,omitempty" yaml:"destinations,omitempty"`
	Collections  []interface{} `mapstructure:"collections" json:"collections,omitempty" yaml:"collections,omitempty"`

	Config map[string]interface{} `mapstructure:"config" json:"config,omitempty" yaml:"config,omitempty"`
}

type Collection struct {
	Name       string                 `mapstructure:"name" json:"name,omitempty" yaml:"name,omitempty"`
	TableName  string                 `mapstructure:"table_name" json:"table_name,omitempty" yaml:"table_name,omitempty"`
	Parameters map[string]interface{} `mapstructure:"parameters" json:"parameters,omitempty" yaml:"parameters,omitempty"`
}

//Create source drivers per collection
//Enrich incoming configs with default values if needed
func Create(ctx context.Context, name string, sourceConfig *SourceConfig) (map[*Collection]Driver, error) {
	if sourceConfig.Type == "" {
		sourceConfig.Type = name
	}

	var collections []*Collection
	for _, collectionConfig := range sourceConfig.Collections {
		collectionName, ok := collectionConfig.(string)
		if ok {
			collections = append(collections, &Collection{Name: collectionName})
		} else {
			collectionConfigMap := cast.ToStringMap(collectionConfig)
			collectionName := getStringParameter(collectionConfigMap, "name")
			if collectionName == "" {
				return nil, fmt.Errorf("failed to parse source collections as array of string or collections structure")
			}
			collection := Collection{Name: collectionName,
				TableName:  getStringParameter(collectionConfigMap, "table_name"),
				Parameters: cast.ToStringMap(collectionConfigMap["parameters"])}
			collections = append(collections, &collection)
		}
	}

	logging.Infof("[%s] Initializing source of type: %s", name, sourceConfig.Type)
	if len(collections) == 0 {
		return nil, errors.New("collections are empty. Please specify at least one collection")
	}
	if len(sourceConfig.Destinations) == 0 {
		return nil, errors.New("destinations are empty. Please specify at least one destination")
	}

	driverPerCollection := map[*Collection]Driver{}

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
			driverPerCollection[collection] = gpd
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
			driverPerCollection[collection] = firebase
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
			driverPerCollection[collection] = ga
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
	return value.(string)
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
