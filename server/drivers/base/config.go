package base

import (
	"errors"
	"fmt"
	"time"

	"github.com/jitsucom/jitsu/server/logging"
	"github.com/jitsucom/jitsu/server/oauth"
	"github.com/jitsucom/jitsu/server/timestamp"
	"github.com/spf13/viper"
)

//StreamConfiguration is a dto for serialization selected streams configuration
type StreamConfiguration struct {
	Name        string   `mapstructure:"name" json:"name,omitempty" yaml:"name,omitempty"`
	Namespace   string   `mapstructure:"namespace" json:"namespace,omitempty" yaml:"namespace,omitempty"`
	SyncMode    string   `mapstructure:"sync_mode" json:"sync_mode,omitempty" yaml:"sync_mode,omitempty"`
	CursorField []string `mapstructure:"cursor_field" json:"cursor_field,omitempty" yaml:"cursor_field,omitempty"`
}

//SourceConfig is a dto for api connector source config serialization
type SourceConfig struct {
	SourceID string `json:"source_id" yaml:"-"`

	Type                   string   `mapstructure:"type" json:"type,omitempty" yaml:"type,omitempty"`
	Destinations           []string `mapstructure:"destinations" json:"destinations,omitempty" yaml:"destinations,omitempty"`
	PostHandleDestinations []string `mapstructure:"post_handle_destinations" json:"post_handle_destinations,omitempty" yaml:"post_handle_destinations,omitempty"`

	Collections []interface{} `mapstructure:"collections" json:"collections,omitempty" yaml:"collections,omitempty"`
	Schedule    string        `mapstructure:"schedule" json:"schedule,omitempty" yaml:"schedule,omitempty"`

	Config        map[string]interface{} `mapstructure:"config" json:"config,omitempty" yaml:"config,omitempty"`
	Notifications map[string]interface{} `mapstructure:"notifications" json:"notifications,omitempty" yaml:"notifications,omitempty"`
	ProjectName   string                 `mapstructure:"project_name" json:"project_name,omitempty" yaml:"project_name,omitempty"`
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
	SyncMode     string                 `mapstructure:"mode" json:"mode,omitempty" yaml:"mode,omitempty"`
	Parameters   map[string]interface{} `mapstructure:"parameters" json:"parameters,omitempty" yaml:"parameters,omitempty"`
}

func (c *Collection) Init() error {
	if c.StartDateStr != "" {
		startDate, err := time.Parse(timestamp.DashDayLayout, c.StartDateStr)
		if err != nil {
			return fmt.Errorf("Malformed start_date in [%s_%s] collection: please use YYYY-MM-DD format: %v", c.SourceID, c.Name, err)
		}

		date := time.Date(startDate.Year(), startDate.Month(), startDate.Day(), 0, 0, 0, 0, time.UTC)
		c.DaysBackToLoad = getDaysBackToLoad(&date)
		logging.Infof("[%s_%s] Using start date: %s", c.SourceID, c.Name, date)
	}
	return nil
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

//return difference between now and t in DAYS + 1 (current day)
//e.g. 2021-03-01 - 2021-03-01 = 0, but we should load current date as well
func getDaysBackToLoad(t *time.Time) int {
	now := timestamp.Now().UTC()
	currentDay := time.Date(now.Year(), now.Month(), now.Day(), 0, 0, 0, 0, now.Location())
	return int(currentDay.Sub(*t).Hours()/24) + 1
}

func StreamIdentifier(namespace, name string) string {
	return namespace + name
}

func FillPreconfiguredOauth(sourceType string, config interface{}) {
	oathFields, ok := oauth.Fields[sourceType]
	if ok {
		sourceConnectorConfig, ok := config.(map[string]interface{})
		if ok {
			for k, v := range oathFields {
				cf, ok := sourceConnectorConfig[k]
				if (!ok || cf == "") && viper.GetString(v) != "" {
					sourceConnectorConfig[k] = viper.GetString(v)
				}
			}
		}
	}
}
