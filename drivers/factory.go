package drivers

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"github.com/jitsucom/eventnative/logging"
)

var unknownSource = errors.New("Unknown source type")

type SourceConfig struct {
	Type         string   `mapstructure:"type" json:"type,omitempty" yaml:"type,omitempty"`
	Destinations []string `mapstructure:"destinations" json:"destinations,omitempty" yaml:"destinations,omitempty"`
	Collections  []string `mapstructure:"collections" json:"collections,omitempty" yaml:"collections,omitempty"`

	Config map[string]interface{} `mapstructure:"config" json:"config,omitempty" yaml:"config,omitempty"`
}

//Create source drivers per collection
//Enrich incoming configs with default values if needed
func Create(ctx context.Context, name string, sourceConfig *SourceConfig) (map[string]Driver, error) {
	if sourceConfig.Type == "" {
		sourceConfig.Type = name
	}

	logging.Infof("[%s] Initializing source of type: %s", name, sourceConfig.Type)
	if len(sourceConfig.Collections) == 0 {
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

		for _, collection := range sourceConfig.Collections {
			gpd, err := NewGooglePlay(ctx, gpCfg, collection)
			if err != nil {
				return nil, fmt.Errorf("error creating [%s] driver for [%s] collection: %v", sourceConfig.Type, collection, err)
			}
			driverPerCollection[collection] = gpd
		}
		return driverPerCollection, nil
	default:
		return nil, unknownSource
	}
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
