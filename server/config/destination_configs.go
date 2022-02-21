package config

import (
	"errors"
	"reflect"
	"strconv"

	"github.com/jitsucom/jitsu/server/enrichment"
	"github.com/jitsucom/jitsu/server/logging"
	"github.com/jitsucom/jitsu/server/utils"
	"github.com/mitchellh/mapstructure"
)

//DestinationConfig is a destination configuration for serialization
type DestinationConfig struct {
	OnlyTokens             []string                 `mapstructure:"only_tokens" json:"only_tokens,omitempty" yaml:"only_tokens,omitempty"`
	Type                   string                   `mapstructure:"type" json:"type,omitempty" yaml:"type,omitempty"`
	Package                string                   `mapstructure:"package" json:"package,omitempty" yaml:"package,omitempty"`
	Mode                   string                   `mapstructure:"mode" json:"mode,omitempty" yaml:"mode,omitempty"`
	DataLayout             *DataLayout              `mapstructure:"data_layout,omitempty" json:"data_layout,omitempty" yaml:"data_layout,omitempty"`
	UsersRecognition       *UsersRecognition        `mapstructure:"users_recognition" json:"users_recognition,omitempty" yaml:"users_recognition,omitempty"`
	Enrichment             []*enrichment.RuleConfig `mapstructure:"enrichment" json:"enrichment,omitempty" yaml:"enrichment,omitempty"`
	Log                    *logging.SQLDebugConfig  `mapstructure:"log" json:"log,omitempty" yaml:"log,omitempty"`
	BreakOnError           bool                     `mapstructure:"break_on_error" json:"break_on_error,omitempty" yaml:"break_on_error,omitempty"`
	Staged                 bool                     `mapstructure:"staged" json:"staged,omitempty" yaml:"staged,omitempty"`
	CachingConfiguration   *CachingConfiguration    `mapstructure:"caching" json:"caching,omitempty" yaml:"caching,omitempty"`
	PostHandleDestinations []string                 `mapstructure:"post_handle_destinations,omitempty" json:"post_handle_destinations,omitempty" yaml:"post_handle_destinations,omitempty"`
	GeoDataResolverID      string                   `mapstructure:"geo_data_resolver_id" json:"geo_data_resolver_id,omitempty" yaml:"geo_data_resolver_id,omitempty"`

	//Deprecated
	DataSource map[string]interface{} `mapstructure:"datasource,omitempty" json:"datasource,omitempty" yaml:"datasource,omitempty"`
	//Deprecated
	S3 map[string]interface{} `mapstructure:"s3,omitempty" json:"s3,omitempty" yaml:"s3,omitempty"`
	//Deprecated
	Google map[string]interface{} `mapstructure:"google,omitempty" json:"google,omitempty" yaml:"google,omitempty"`
	//Deprecated
	GoogleAnalytics map[string]interface{} `mapstructure:"google_analytics,omitempty" json:"google_analytics,omitempty" yaml:"google_analytics,omitempty"`
	//Deprecated
	ClickHouse map[string]interface{} `mapstructure:"clickhouse,omitempty" json:"clickhouse,omitempty" yaml:"clickhouse,omitempty"`
	//Deprecated
	Snowflake map[string]interface{} `mapstructure:"snowflake,omitempty" json:"snowflake,omitempty" yaml:"snowflake,omitempty"`
	//Deprecated
	Facebook map[string]interface{} `mapstructure:"facebook,omitempty" json:"facebook,omitempty" yaml:"facebook,omitempty"`
	//Deprecated
	WebHook map[string]interface{} `mapstructure:"webhook,omitempty" json:"webhook,omitempty" yaml:"webhook,omitempty"`
	//Deprecated
	Amplitude map[string]interface{} `mapstructure:"amplitude,omitempty" json:"amplitude,omitempty" yaml:"amplitude,omitempty"`
	//Deprecated
	HubSpot map[string]interface{} `mapstructure:"hubspot,omitempty" json:"hubspot,omitempty" yaml:"hubspot,omitempty"`
	//Deprecated
	DbtCloud map[string]interface{} `mapstructure:"dbtcloud,omitempty" json:"dbtcloud,omitempty" yaml:"dbtcloud,omitempty"`

	Config map[string]interface{} `mapstructure:"config,omitempty" json:"config,omitempty" yaml:"config,omitempty"`
}

func (config *DestinationConfig) GetDestConfig(compatibilityValue map[string]interface{}, dest Validatable) error {
	mp := utils.NvlMap(config.Config, compatibilityValue)
	//backward compatibility with port number as string
	sPort, ok := mp["port"].(string)
	if ok {
		if len(sPort) > 0 {
			iPort, err := strconv.Atoi(sPort)
			if err == nil {
				mp["port"] = iPort
			}
		} else {
			mp["port"] = 0
		}
	}
	if err := mapstructure.Decode(mp, dest); err != nil {
		return err
	}
	return dest.Validate()
}

func (config *DestinationConfig) GetConfig(value Validatable, compatibilityValue map[string]interface{}, dest Validatable) (Validatable, error) {
	if !reflect.ValueOf(value).IsNil() {
		return value, nil
	}
	if compatibilityValue == nil {
		return nil, nil
	}
	if err := mapstructure.Decode(compatibilityValue, dest); err != nil {
		return nil, err
	}
	return dest, nil
}

//DataLayout is used for configure mappings/table names and other data layout parameters
type DataLayout struct {
	//Deprecated
	MappingType FieldMappingType `mapstructure:"mapping_type" json:"mapping_type,omitempty" yaml:"mapping_type,omitempty"`
	//Deprecated
	Mapping []string `mapstructure:"mapping" json:"mapping,omitempty" yaml:"mapping,omitempty"`

	TransformEnabled *bool  `mapstructure:"transform_enabled" json:"transform_enabled,omitempty" yaml:"transform_enabled,omitempty"`
	Transform        string `mapstructure:"transform" json:"transform,omitempty" yaml:"transform,omitempty"`
	//Deprecated
	Mappings          *Mapping `mapstructure:"mappings" json:"mappings,omitempty" yaml:"mappings,omitempty"`
	MaxColumns        int      `mapstructure:"max_columns" json:"max_columns,omitempty" yaml:"max_columns,omitempty"`
	TableNameTemplate string   `mapstructure:"table_name_template" json:"table_name_template,omitempty" yaml:"table_name_template,omitempty"`
	PrimaryKeyFields  []string `mapstructure:"primary_key_fields" json:"primary_key_fields,omitempty" yaml:"primary_key_fields,omitempty"`
	UniqueIDField     string   `mapstructure:"unique_id_field" json:"unique_id_field,omitempty" yaml:"unique_id_field,omitempty"`
}

//UsersRecognition is a model for Users recognition module configuration
type UsersRecognition struct {
	Enabled             bool     `mapstructure:"enabled" json:"enabled,omitempty" yaml:"enabled,omitempty"`
	AnonymousIDNode     string   `mapstructure:"anonymous_id_node" json:"anonymous_id_node,omitempty" yaml:"anonymous_id_node,omitempty"`
	IdentificationNodes []string `mapstructure:"identification_nodes" json:"identification_nodes,omitempty" yaml:"identification_nodes,omitempty"`
	UserIDNode          string   `mapstructure:"user_id_node" json:"user_id_node,omitempty" yaml:"user_id_node,omitempty"`
	PoolSize            int      `mapstructure:"pool_size" json:"pool_size,omitempty" yaml:"pool_size,omitempty"`
	Compression         string   `mapstructure:"compression" json:"compression,omitempty" yaml:"compression,omitempty"`
	CacheTTLMin         int      `mapstructure:"cache_ttl_min" json:"cache_ttl_min,omitempty" yaml:"cache_ttl_min,omitempty"`
}

//CachingConfiguration is a configuration for disabling caching
type CachingConfiguration struct {
	Disabled bool `mapstructure:"disabled" json:"disabled" yaml:"disabled"`
}

//IsEnabled returns true if enabled
func (ur *UsersRecognition) IsEnabled() bool {
	return ur != nil && ur.Enabled
}

//Validate returns err if invalid
func (ur *UsersRecognition) Validate() error {
	if ur.IsEnabled() {
		if ur.AnonymousIDNode == "" {
			return errors.New("users_recognition.anonymous_id_node is required")
		}

		if len(ur.IdentificationNodes) == 0 {
			//DEPRECATED node check (backward compatibility)
			if ur.UserIDNode == "" {
				return errors.New("users_recognition.identification_nodes is required")
			}
		}
	}

	return nil
}

type Validatable interface {
	Validate() error
}
