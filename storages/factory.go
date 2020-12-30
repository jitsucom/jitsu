package storages

import (
	"context"
	"errors"
	"fmt"
	"github.com/jitsucom/eventnative/adapters"
	"github.com/jitsucom/eventnative/caching"
	"github.com/jitsucom/eventnative/enrichment"
	"github.com/jitsucom/eventnative/events"
	"github.com/jitsucom/eventnative/jsonutils"
	"github.com/jitsucom/eventnative/logging"
	"github.com/jitsucom/eventnative/schema"
)

const (
	defaultTableName = "events"

	BatchMode  = "batch"
	StreamMode = "stream"
)

var unknownDestination = errors.New("Unknown destination type")

type DestinationConfig struct {
	OnlyTokens       []string                 `mapstructure:"only_tokens" json:"only_tokens,omitempty" yaml:"only_tokens,omitempty"`
	Type             string                   `mapstructure:"type" json:"type,omitempty" yaml:"type,omitempty"`
	Mode             string                   `mapstructure:"mode" json:"mode,omitempty" yaml:"mode,omitempty"`
	DataLayout       *DataLayout              `mapstructure:"data_layout" json:"data_layout,omitempty" yaml:"data_layout,omitempty"`
	UsersRecognition *UsersRecognition        `mapstructure:"users_recognition" json:"users_recognition,omitempty" yaml:"users_recognition,omitempty"`
	Enrichment       []*enrichment.RuleConfig `mapstructure:"enrichment" json:"enrichment,omitempty" yaml:"enrichment,omitempty"`
	BreakOnError     bool                     `mapstructure:"break_on_error" json:"break_on_error,omitempty" yaml:"break_on_error,omitempty"`

	DataSource      *adapters.DataSourceConfig      `mapstructure:"datasource" json:"datasource,omitempty" yaml:"datasource,omitempty"`
	S3              *adapters.S3Config              `mapstructure:"s3" json:"s3,omitempty" yaml:"s3,omitempty"`
	Google          *adapters.GoogleConfig          `mapstructure:"google" json:"google,omitempty" yaml:"google,omitempty"`
	GoogleAnalytics *adapters.GoogleAnalyticsConfig `mapstructure:"google_analytics" json:"google_analytics,omitempty" yaml:"google_analytics,omitempty"`
	ClickHouse      *adapters.ClickHouseConfig      `mapstructure:"clickhouse" json:"clickhouse,omitempty" yaml:"clickhouse,omitempty"`
	Snowflake       *adapters.SnowflakeConfig       `mapstructure:"snowflake" json:"snowflake,omitempty" yaml:"snowflake,omitempty"`
}

type DataLayout struct {
	MappingType       schema.FieldMappingType `mapstructure:"mapping_type" json:"mapping_type,omitempty" yaml:"mapping_type,omitempty"`
	Mapping           []string                `mapstructure:"mapping" json:"mapping,omitempty" yaml:"mapping,omitempty"`
	Mappings          *schema.Mapping         `mapstructure:"mappings" json:"mappings,omitempty" yaml:"mappings,omitempty"`
	TableNameTemplate string                  `mapstructure:"table_name_template" json:"table_name_template,omitempty" yaml:"table_name_template,omitempty"`
	PrimaryKeyFields  []string                `mapstructure:"primary_key_fields" json:"primary_key_fields,omitempty" yaml:"primary_key_fields,omitempty"`
}

type UsersRecognition struct {
	Enabled         bool   `mapstructure:"enabled" json:"enabled,omitempty" yaml:"enabled,omitempty"`
	AnonymousIdNode string `mapstructure:"anonymous_id_node" json:"anonymous_id_node,omitempty" yaml:"anonymous_id_node,omitempty"`
	UserIdNode      string `mapstructure:"user_id_node" json:"user_id_node,omitempty" yaml:"user_id_node,omitempty"`
}

func (ur *UsersRecognition) Validate() error {
	if ur != nil && ur.Enabled {
		if ur.AnonymousIdNode == "" {
			return errors.New("anonymous_id_node is required")
		}

		if ur.UserIdNode == "" {
			return errors.New("user_id_node is required")
		}
	}

	return nil
}

type Config struct {
	ctx              context.Context
	name             string
	destination      *DestinationConfig
	usersRecognition *UserRecognitionConfiguration
	processor        *schema.Processor
	streamMode       bool
	monitorKeeper    MonitorKeeper
	eventQueue       *events.PersistentQueue
	eventsCache      *caching.EventsCache
	loggerFactory    *logging.Factory
	pkFields         map[string]bool
	sqlTypeCasts     map[string]string
}

//Create event storage proxy and event consumer (logger or event-queue)
//Enrich incoming configs with default values if needed
func Create(ctx context.Context, name, logEventPath string, destination DestinationConfig, monitorKeeper MonitorKeeper,
	eventsCache *caching.EventsCache, loggerFactory *logging.Factory) (StorageProxy, *events.PersistentQueue, error) {
	if destination.Type == "" {
		destination.Type = name
	}
	if destination.Mode == "" {
		destination.Mode = BatchMode
	}

	logging.Infof("[%s] Initializing destination of type: %s in mode: %s", name, destination.Type, destination.Mode)

	var tableName string
	var oldStyleMappings []string
	var newStyleMapping *schema.Mapping
	pkFields := map[string]bool{}
	mappingFieldType := schema.Default
	if destination.DataLayout != nil {
		mappingFieldType = destination.DataLayout.MappingType
		oldStyleMappings = destination.DataLayout.Mapping
		newStyleMapping = destination.DataLayout.Mappings

		if destination.DataLayout.TableNameTemplate != "" {
			tableName = destination.DataLayout.TableNameTemplate
		}

		for _, field := range destination.DataLayout.PrimaryKeyFields {
			pkFields[field] = true
		}
	}

	if tableName == "" {
		tableName = defaultTableName
		logging.Infof("[%s] uses default table name: %s", name, tableName)
	}

	if destination.Mode != BatchMode && destination.Mode != StreamMode {
		return nil, nil, fmt.Errorf("Unknown destination mode: %s. Available mode: [%s, %s]", destination.Mode, BatchMode, StreamMode)
	}

	if len(destination.Enrichment) == 0 {
		logging.Warnf("[%s] doesn't have enrichment rules", name)
	} else {
		logging.Infof("[%s] Configured enrichment rules:", name)
	}

	//default enrichment rules
	enrichmentRules := []enrichment.Rule{
		enrichment.DefaultJsIpRule,
		enrichment.DefaultJsUaRule,
	}

	//configured enrichment rules
	for _, ruleConfig := range destination.Enrichment {
		logging.Infof("[%s] %s", name, ruleConfig.String())

		rule, err := enrichment.NewRule(ruleConfig)
		if err != nil {
			return nil, nil, fmt.Errorf("Error creating enrichment rule [%s]: %v", ruleConfig.String(), err)
		}

		enrichmentRules = append(enrichmentRules, rule)
	}

	fieldMapper, sqlTypeCasts, err := schema.NewFieldMapper(mappingFieldType, oldStyleMappings, newStyleMapping)
	if err != nil {
		return nil, nil, err
	}

	//write current mapping configuration to logs
	if newStyleMapping != nil && len(newStyleMapping.Fields) != 0 {
		mappingMode := "keep unmapped fields"
		if newStyleMapping.KeepUnmapped != nil && !*newStyleMapping.KeepUnmapped {
			mappingMode = "remove unmapped fields"
		}
		logging.Infof("[%s] Configured field mapping rules with [%s] mode:", name, mappingMode)
		for _, mrc := range newStyleMapping.Fields {
			logging.Infof("[%s] %s", name, mrc.String())
		}
	} else if len(oldStyleMappings) > 0 {
		logging.Infof("[%s] Configured field mapping rules with [%s] mode:", name, mappingFieldType)
		for _, m := range oldStyleMappings {
			logging.Infof("[%s] %s", name, m)
		}
	} else {
		logging.Warnf("[%s] doesn't have mapping rules", name)
	}

	//retrospective users recognition
	var usersRecognition *UserRecognitionConfiguration
	if destination.UsersRecognition != nil {
		err := destination.UsersRecognition.Validate()
		if err != nil {
			logging.Infof("[%s] invalid users recognition configuration: %v", name, err)
		} else {
			usersRecognition = &UserRecognitionConfiguration{
				Enabled:             destination.UsersRecognition.Enabled,
				AnonymousIdJsonPath: jsonutils.NewJsonPath(destination.UsersRecognition.AnonymousIdNode),
				UserIdJsonPath:      jsonutils.NewJsonPath(destination.UsersRecognition.UserIdNode),
			}
		}
	} else {
		logging.Infof("[%s] users recognition isn't configured", name)
	}

	//duplication data error warning
	//don't process user recognition in this case
	if destination.Type == PostgresType && len(pkFields) == 0 {
		logging.Errorf("[%s] retrospective users recognition is disabled: primary_key_fields must be configured (otherwise data duplication will occurred)", name)
		usersRecognition = &UserRecognitionConfiguration{Enabled: false}
	}

	processor, err := schema.NewProcessor(name, tableName, fieldMapper, enrichmentRules, destination.BreakOnError)
	if err != nil {
		return nil, nil, err
	}

	var eventQueue *events.PersistentQueue
	if destination.Mode == StreamMode {
		eventQueue, err = events.NewPersistentQueue("queue.dst="+name, logEventPath)
		if err != nil {
			return nil, nil, err
		}
	}

	storageConfig := &Config{
		ctx:              ctx,
		name:             name,
		destination:      &destination,
		usersRecognition: usersRecognition,
		processor:        processor,
		streamMode:       destination.Mode == StreamMode,
		monitorKeeper:    monitorKeeper,
		eventQueue:       eventQueue,
		eventsCache:      eventsCache,
		loggerFactory:    loggerFactory,
		pkFields:         pkFields,
		sqlTypeCasts:     sqlTypeCasts,
	}

	var storageProxy StorageProxy
	switch destination.Type {
	case RedshiftType:
		storageProxy = newProxy(NewAwsRedshift, storageConfig)
	case BigQueryType:
		storageProxy = newProxy(NewBigQuery, storageConfig)
	case PostgresType:
		storageProxy = newProxy(NewPostgres, storageConfig)
	case ClickHouseType:
		storageProxy = newProxy(NewClickHouse, storageConfig)
	case S3Type:
		storageProxy = newProxy(NewS3, storageConfig)
	case SnowflakeType:
		storageProxy = newProxy(NewSnowflake, storageConfig)
	case GoogleAnalyticsType:
		storageProxy = newProxy(NewGoogleAnalytics, storageConfig)
	default:
		if eventQueue != nil {
			eventQueue.Close()
		}
		return nil, nil, unknownDestination
	}

	return storageProxy, eventQueue, nil
}
