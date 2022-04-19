package jitsu_sdk

import (
	"errors"
)

//Config is a dto for sdk source configuration serialization
type Config struct {
	Package                string                 `mapstructure:"package_name" json:"package_name,omitempty" yaml:"package_name,omitempty"`
	PackageVersion         string                 `mapstructure:"package_version" json:"package_version,omitempty" yaml:"package_version,omitempty"`
	Config                 map[string]interface{} `mapstructure:"config" json:"config,omitempty" yaml:"config,omitempty"`
	Catalog                interface{}            `mapstructure:"catalog" json:"catalog,omitempty" yaml:"catalog,omitempty"`
	InitialState           interface{}            `mapstructure:"initial_state" json:"initial_state,omitempty" yaml:"initial_state,omitempty"`
	StreamTableNames       map[string]string      `mapstructure:"stream_table_names" json:"stream_table_names,omitempty" yaml:"stream_table_names,omitempty"`
	StreamTableNamesPrefix string                 `mapstructure:"stream_table_name_prefix" json:"stream_table_name_prefix,omitempty" yaml:"stream_table_name_prefix,omitempty"`
	SelectedStreams        []StreamConfiguration  `mapstructure:"selected_streams" json:"selected_streams,omitempty" yaml:"selected_streams,omitempty"`
}

//StreamConfiguration is a dto for serialization selected streams configuration
type StreamConfiguration struct {
	Name     string                 `mapstructure:"name" json:"name,omitempty" yaml:"name,omitempty"`
	SyncMode string                 `mapstructure:"mode" json:"mode,omitempty" yaml:"mode,omitempty"`
	Params   map[string]interface{} `mapstructure:"params" json:"params,omitempty" yaml:"params,omitempty"`
}

//Validate returns err if configuration is invalid
func (ac *Config) Validate() error {
	if ac == nil {
		return errors.New("SDK source config is required. Please read docs https://jitsu.com/docs/sources-configuration/airbyte")
	}

	if ac.Package == "" {
		return errors.New("SDK source package is required")
	}

	if ac.Config == nil {
		return errors.New("SDK source config is required. Please read docs https://jitsu.com/docs/sources-configuration/airbyte")
	}

	if ac.StreamTableNames == nil {
		ac.StreamTableNames = map[string]string{}
	}

	return nil
}
