package config

import (
	"errors"
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
	DataLayout             *DataLayout              `mapstructure:"data_layout" json:"data_layout,omitempty" yaml:"data_layout,omitempty"`
	UsersRecognition       *UsersRecognition        `mapstructure:"users_recognition" json:"users_recognition,omitempty" yaml:"users_recognition,omitempty"`
	Enrichment             []*enrichment.RuleConfig `mapstructure:"enrichment" json:"enrichment,omitempty" yaml:"enrichment,omitempty"`
	Log                    *logging.SQLDebugConfig  `mapstructure:"log" json:"log,omitempty" yaml:"log,omitempty"`
	BreakOnError           bool                     `mapstructure:"break_on_error" json:"break_on_error,omitempty" yaml:"break_on_error,omitempty"`
	Staged                 bool                     `mapstructure:"staged" json:"staged,omitempty" yaml:"staged,omitempty"`
	CachingConfiguration   *CachingConfiguration    `mapstructure:"caching" json:"caching,omitempty" yaml:"caching,omitempty"`
	PostHandleDestinations []string                 `mapstructure:"post_handle_destinations" json:"post_handle_destinations,omitempty" yaml:"post_handle_destinations,omitempty"`
	GeoDataResolverID      string                   `mapstructure:"geo_data_resolver_id" json:"geo_data_resolver_id,omitempty" yaml:"geo_data_resolver_id,omitempty"`

	//variables that can be used from javascript
	TemplateVariables map[string]interface{} `mapstructure:"template_variables" json:"template_variables,omitempty" yaml:"template_variables,omitempty"`

	//Deprecated
	DataSource map[string]interface{} `mapstructure:"datasource" json:"datasource,omitempty" yaml:"datasource,omitempty"`
	//Deprecated
	S3 map[string]interface{} `mapstructure:"s3" json:"s3,omitempty" yaml:"s3,omitempty"`
	//Deprecated
	Google map[string]interface{} `mapstructure:"google" json:"google,omitempty" yaml:"google,omitempty"`
	//Deprecated
	GoogleAnalytics map[string]interface{} `mapstructure:"google_analytics" json:"google_analytics,omitempty" yaml:"google_analytics,omitempty"`
	//Deprecated
	ClickHouse map[string]interface{} `mapstructure:"clickhouse" json:"clickhouse,omitempty" yaml:"clickhouse,omitempty"`
	//Deprecated
	Snowflake map[string]interface{} `mapstructure:"snowflake" json:"snowflake,omitempty" yaml:"snowflake,omitempty"`
	//Deprecated
	Facebook map[string]interface{} `mapstructure:"facebook" json:"facebook,omitempty" yaml:"facebook,omitempty"`
	//Deprecated
	WebHook map[string]interface{} `mapstructure:"webhook" json:"webhook,omitempty" yaml:"webhook,omitempty"`
	//Deprecated
	Amplitude map[string]interface{} `mapstructure:"amplitude" json:"amplitude,omitempty" yaml:"amplitude,omitempty"`
	//Deprecated
	HubSpot map[string]interface{} `mapstructure:"hubspot" json:"hubspot,omitempty" yaml:"hubspot,omitempty"`
	//Deprecated
	DbtCloud map[string]interface{} `mapstructure:"dbtcloud" json:"dbtcloud,omitempty" yaml:"dbtcloud,omitempty"`

	Config map[string]interface{} `mapstructure:"config" json:"config,omitempty" yaml:"config,omitempty"`
}

func (config *DestinationConfig) GetDestConfig(compatibilityValue map[string]interface{}, dest Validatable) error {
	logging.Infof("compat: %s\nconfig: %s\n", compatibilityValue, config.Config)
	mp := utils.Nvl(config.Config, compatibilityValue)
	if err := mapstructure.Decode(mp, dest); err != nil {
		return err
	}
	return dest.Validate()
}

func (config *DestinationConfig) GetConfig(value Validatable, compatibilityValue map[string]interface{}, dest Validatable) (Validatable, error) {
	if value != nil {
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

func (config *DestinationConfig) Validate() error {
	//if config.Config != nil {
	//	if err := config.Config.Validate(); err != nil {
	//		return err
	//	}
	//}
	//
	//deprecatedConfigs := []Validatable{config.DbtCloud,
	//	config.HubSpot, config.Amplitude, config.WebHook, config.Facebook, config.Google,
	//	config.Snowflake, config.ClickHouse, config.GoogleAnalytics, config.S3, config.DataSource}
	//
	//for _, validatable := range deprecatedConfigs {
	//	if validatable != nil {
	//		if err := validatable.Validate(); err != nil {
	//			return err
	//		}
	//	}
	//}
	return nil
}

//DataLayout is used for configure mappings/table names and other data layout parameters
type DataLayout struct {
	//Deprecated
	MappingType FieldMappingType `mapstructure:"mapping_type" json:"mapping_type,omitempty" yaml:"mapping_type,omitempty"`
	//Deprecated
	Mapping []string `mapstructure:"mapping" json:"mapping,omitempty" yaml:"mapping,omitempty"`

	TransformEnabled *bool  `mapstructure:"transform_enabled" json:"transform_enabled" yaml:"transform_enabled"`
	Transform        string `mapstructure:"transform" json:"transform,omitempty" yaml:"transform,omitempty"`
	//Deprecated
	Mappings          *Mapping `mapstructure:"mappings" json:"mappings,omitempty" yaml:"mappings,omitempty"`
	MaxColumns        int      `mapstructure:"max_columns" json:"max_columns,omitempty" yaml:"max_columns,omitempty"`
	TableNameTemplate string          `mapstructure:"table_name_template" json:"table_name_template,omitempty" yaml:"table_name_template,omitempty"`
	PrimaryKeyFields  []string        `mapstructure:"primary_key_fields" json:"primary_key_fields,omitempty" yaml:"primary_key_fields,omitempty"`
	UniqueIDField     string          `mapstructure:"unique_id_field" json:"unique_id_field,omitempty" yaml:"unique_id_field,omitempty"`
}

//UsersRecognition is a model for Users recognition module configuration
type UsersRecognition struct {
	Enabled             bool     `mapstructure:"enabled" json:"enabled,omitempty" yaml:"enabled,omitempty"`
	AnonymousIDNode     string   `mapstructure:"anonymous_id_node" json:"anonymous_id_node,omitempty" yaml:"anonymous_id_node,omitempty"`
	IdentificationNodes []string `mapstructure:"identification_nodes" json:"identification_nodes,omitempty" yaml:"identification_nodes,omitempty"`
	UserIDNode          string   `mapstructure:"user_id_node" json:"user_id_node,omitempty" yaml:"user_id_node,omitempty"`
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

