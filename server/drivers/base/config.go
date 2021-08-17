package base

import (
	"errors"
	"github.com/jitsucom/jitsu/server/logging"
)

//SourceConfig is a dto for api connector source config serialization
type SourceConfig struct {
	SourceID string `json:"source_id" yaml:"-"`

	Type         string        `mapstructure:"type" json:"type,omitempty" yaml:"type,omitempty"`
	Destinations []string      `mapstructure:"destinations" json:"destinations,omitempty" yaml:"destinations,omitempty"`
	PostHandleDestinations []string      `mapstructure:"post_handle_destinations" json:"post_handle_destinations,omitempty" yaml:"post_handle_destinations,omitempty"`

	Collections  []interface{} `mapstructure:"collections" json:"collections,omitempty" yaml:"collections,omitempty"`
	Schedule     string        `mapstructure:"schedule" json:"schedule,omitempty" yaml:"schedule,omitempty"`

	Config map[string]interface{} `mapstructure:"config" json:"config,omitempty" yaml:"config,omitempty"`
}

//Collection is a dto for report unit serialization
type Collection struct {
	DaysBackToLoad int    `json:"-" yaml:"-"` //without serialization
	SourceID       string `json:"-" yaml:"-"` //without serialization

	Name         string                 `mapstructure:"name" json:"name,omitempty" yaml:"name,omitempty"`
	Type         string                 `mapstructure:"type" json:"type,omitempty" yaml:"type,omitempty"`
	TableName    string                 `mapstructure:"table_name" json:"table_name,omitempty" yaml:"table_name,omitempty"`
	StartDateStr string                 `mapstructure:"start_date" json:"start_date,omitempty" yaml:"start_date,omitempty"`
	Schedule     string                 `mapstructure:"schedule" json:"schedule,omitempty" yaml:"schedule,omitempty"`
	Parameters   map[string]interface{} `mapstructure:"parameters" json:"parameters,omitempty" yaml:"parameters,omitempty"`
}

//Validate returns err if collection invalid
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
