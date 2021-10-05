package singer

import "errors"

//SingerRawCatalog is a dto for Singer catalog serialization
type SingerRawCatalog struct {
	Streams []map[string]interface{} `json:"streams,omitempty"`
}

//SingerCatalog is a dto for Singer catalog partly serialization (only for extracting destination_table_name)
type SingerCatalog struct {
	Streams []SingerStreamCatalog `json:"streams,omitempty"`
}

//SingerStreamCatalog is a dto for Singer catalog Stream object serialization
type SingerStreamCatalog struct {
	Stream               string `json:"stream,omitempty"`
	TapStreamID          string `json:"tap_stream_id,omitempty"`
	DestinationTableName string `json:"destination_table_name,omitempty"`
}

//SingerConfig is a dto for Singer configuration serialization
type SingerConfig struct {
	Tap                    string            `mapstructure:"tap" json:"tap,omitempty" yaml:"tap,omitempty"`
	Config                 interface{}       `mapstructure:"config" json:"config,omitempty" yaml:"config,omitempty"`
	Catalog                interface{}       `mapstructure:"catalog" json:"catalog,omitempty" yaml:"catalog,omitempty"`
	Properties             interface{}       `mapstructure:"properties" json:"properties,omitempty" yaml:"properties,omitempty"`
	InitialState           interface{}       `mapstructure:"initial_state" json:"initial_state,omitempty" yaml:"initial_state,omitempty"`
	StreamTableNames       map[string]string `mapstructure:"stream_table_names" json:"stream_table_names,omitempty" yaml:"stream_table_names,omitempty"`
	StreamTableNamesPrefix string            `mapstructure:"stream_table_name_prefix" json:"stream_table_name_prefix,omitempty" yaml:"stream_table_name_prefix,omitempty"`
}

//Validate returns err if configuration is invalid
func (sc *SingerConfig) Validate() error {
	if sc == nil {
		return errors.New("Singer config is required")
	}

	if sc.Tap == "" {
		return errors.New("Singer tap is required")
	}

	if sc.Config == nil {
		return errors.New("Singer config is required")
	}

	if sc.StreamTableNames == nil {
		sc.StreamTableNames = map[string]string{}
	}

	return nil
}
