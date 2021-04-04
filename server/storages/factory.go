package storages

import (
	"context"
	"errors"
	"fmt"
	"strings"

	"github.com/jitsucom/jitsu/server/adapters"
	"github.com/jitsucom/jitsu/server/appconfig"
	"github.com/jitsucom/jitsu/server/caching"
	"github.com/jitsucom/jitsu/server/enrichment"
	"github.com/jitsucom/jitsu/server/events"
	"github.com/jitsucom/jitsu/server/jsonutils"
	"github.com/jitsucom/jitsu/server/logging"
	"github.com/jitsucom/jitsu/server/schema"
	"github.com/jitsucom/jitsu/server/typing"
)

const (
	defaultTableName = "events"

	BatchMode  = "batch"
	StreamMode = "stream"
)

var (
	ErrUnknownDestination = errors.New("Unknown destination type")
	StorageConstructors   = make(map[string]func(*Config) (Storage, error))
)

type DestinationConfig struct {
	OnlyTokens       []string                 `mapstructure:"only_tokens" json:"only_tokens,omitempty" yaml:"only_tokens,omitempty"`
	Type             string                   `mapstructure:"type" json:"type,omitempty" yaml:"type,omitempty"`
	Mode             string                   `mapstructure:"mode" json:"mode,omitempty" yaml:"mode,omitempty"`
	DataLayout       *DataLayout              `mapstructure:"data_layout" json:"data_layout,omitempty" yaml:"data_layout,omitempty"`
	UsersRecognition *UsersRecognition        `mapstructure:"users_recognition" json:"users_recognition,omitempty" yaml:"users_recognition,omitempty"`
	Enrichment       []*enrichment.RuleConfig `mapstructure:"enrichment" json:"enrichment,omitempty" yaml:"enrichment,omitempty"`
	Log              *logging.SQLDebugConfig  `mapstructure:"log" json:"log,omitempty" yaml:"log,omitempty"`
	BreakOnError     bool                     `mapstructure:"break_on_error" json:"break_on_error,omitempty" yaml:"break_on_error,omitempty"`
	Staged           bool                     `mapstructure:"staged" json:"staged,omitempty" yaml:"staged,omitempty"`

	DataSource      *adapters.DataSourceConfig            `mapstructure:"datasource" json:"datasource,omitempty" yaml:"datasource,omitempty"`
	S3              *adapters.S3Config                    `mapstructure:"s3" json:"s3,omitempty" yaml:"s3,omitempty"`
	Google          *adapters.GoogleConfig                `mapstructure:"google" json:"google,omitempty" yaml:"google,omitempty"`
	GoogleAnalytics *adapters.GoogleAnalyticsConfig       `mapstructure:"google_analytics" json:"google_analytics,omitempty" yaml:"google_analytics,omitempty"`
	ClickHouse      *adapters.ClickHouseConfig            `mapstructure:"clickhouse" json:"clickhouse,omitempty" yaml:"clickhouse,omitempty"`
	Snowflake       *adapters.SnowflakeConfig             `mapstructure:"snowflake" json:"snowflake,omitempty" yaml:"snowflake,omitempty"`
	Facebook        *adapters.FacebookConversionAPIConfig `mapstructure:"facebook" json:"facebook,omitempty" yaml:"facebook,omitempty"`
}

type DataLayout struct {
	//Deprecated
	MappingType schema.FieldMappingType `mapstructure:"mapping_type" json:"mapping_type,omitempty" yaml:"mapping_type,omitempty"`
	//Deprecated
	Mapping []string `mapstructure:"mapping" json:"mapping,omitempty" yaml:"mapping,omitempty"`

	Mappings          *schema.Mapping `mapstructure:"mappings" json:"mappings,omitempty" yaml:"mappings,omitempty"`
	MaxColumns        int             `mapstructure:"max_columns" json:"max_columns,omitempty" yaml:"max_columns,omitempty"`
	TableNameTemplate string          `mapstructure:"table_name_template" json:"table_name_template,omitempty" yaml:"table_name_template,omitempty"`
	PrimaryKeyFields  []string        `mapstructure:"primary_key_fields" json:"primary_key_fields,omitempty" yaml:"primary_key_fields,omitempty"`
}

type UsersRecognition struct {
	Enabled             bool     `mapstructure:"enabled" json:"enabled,omitempty" yaml:"enabled,omitempty"`
	AnonymousIDNode     string   `mapstructure:"anonymous_id_node" json:"anonymous_id_node,omitempty" yaml:"anonymous_id_node,omitempty"`
	IdentificationNodes []string `mapstructure:"identification_nodes" json:"identification_nodes,omitempty" yaml:"identification_nodes,omitempty"`
	UserIDNode          string   `mapstructure:"user_id_node" json:"user_id_node,omitempty" yaml:"user_id_node,omitempty"`
}

func (ur *UsersRecognition) IsEnabled() bool {
	return ur != nil && ur.Enabled
}

func (ur *UsersRecognition) Validate() error {
	if ur.IsEnabled() {
		if ur.AnonymousIDNode == "" {
			return errors.New("anonymous_id_node is required")
		}

		if len(ur.IdentificationNodes) == 0 {
			if ur.UserIDNode == "" {
				return errors.New("identification_nodes is required")
			} else {
				logging.Warn("user_id_node is deprecated. Please use identification_nodes instead")
				ur.IdentificationNodes = []string{ur.UserIDNode}
			}
		}
	}

	return nil
}

type Config struct {
	ctx              context.Context
	destinationID    string
	destination      *DestinationConfig
	usersRecognition *UserRecognitionConfiguration
	processor        *schema.Processor
	streamMode       bool
	maxColumns       int
	monitorKeeper    MonitorKeeper
	eventQueue       *events.PersistentQueue
	eventsCache      *caching.EventsCache
	loggerFactory    *logging.Factory
	pkFields         map[string]bool
	sqlTypes         typing.SQLTypes
}

//RegisterStorage registers function to create new storage(destination) instance
func RegisterStorage(storageType string,
	createStorageFunc func(config *Config) (Storage, error)) {
	StorageConstructors[storageType] = createStorageFunc
}

type Factory interface {
	Create(name string, destination DestinationConfig) (StorageProxy, *events.PersistentQueue, error)
}

type FactoryImpl struct {
	ctx                 context.Context
	logEventPath        string
	monitorKeeper       MonitorKeeper
	eventsCache         *caching.EventsCache
	globalLoggerFactory *logging.Factory
	globalConfiguration *UsersRecognition
	maxColumns          int
}

func NewFactory(ctx context.Context, logEventPath string, monitorKeeper MonitorKeeper, eventsCache *caching.EventsCache,
	globalLoggerFactory *logging.Factory, globalConfiguration *UsersRecognition, maxColumns int) Factory {
	return &FactoryImpl{
		ctx:                 ctx,
		logEventPath:        logEventPath,
		monitorKeeper:       monitorKeeper,
		eventsCache:         eventsCache,
		globalLoggerFactory: globalLoggerFactory,
		globalConfiguration: globalConfiguration,
		maxColumns:          maxColumns,
	}
}

//Create event storage proxy and event consumer (logger or event-queue)
//Enrich incoming configs with default values if needed
func (f *FactoryImpl) Create(destinationID string, destination DestinationConfig) (StorageProxy, *events.PersistentQueue, error) {
	if destination.Type == "" {
		destination.Type = destinationID
	}
	if destination.Mode == "" {
		destination.Mode = BatchMode
	}

	logging.Infof("[%s] Initializing destination of type: %s in mode: %s", destinationID, destination.Type, destination.Mode)

	storageConstructor, ok := StorageConstructors[destination.Type]
	if !ok {
		return nil, nil, ErrUnknownDestination
	}

	var tableName string
	var oldStyleMappings []string
	var newStyleMapping *schema.Mapping
	pkFields := map[string]bool{}
	mappingFieldType := schema.Default
	maxColumns := f.maxColumns
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

		if destination.DataLayout.MaxColumns > 0 {
			maxColumns = destination.DataLayout.MaxColumns

			logging.Infof("[%s] uses max_columns setting: %d", destinationID, maxColumns)
		}
	}

	if tableName == "" {
		tableName = defaultTableName
		logging.Infof("[%s] uses default table destinationID: %s", destinationID, tableName)
	}

	if len(pkFields) > 0 {
		logging.Infof("[%s] has primary key fields: [%s]", destinationID, strings.Join(destination.DataLayout.PrimaryKeyFields, ", "))
	} else {
		logging.Infof("[%s] doesn't have primary key fields", destinationID)
	}

	if destination.Mode != BatchMode && destination.Mode != StreamMode {
		return nil, nil, fmt.Errorf("Unknown destination mode: %s. Available mode: [%s, %s]", destination.Mode, BatchMode, StreamMode)
	}

	if len(destination.Enrichment) == 0 {
		logging.Warnf("[%s] doesn't have enrichment rules", destinationID)
	} else {
		logging.Infof("[%s] Configured enrichment rules:", destinationID)
	}

	//default enrichment rules
	enrichmentRules := []enrichment.Rule{
		enrichment.DefaultJsIPRule,
		enrichment.DefaultJsUaRule,
	}

	// ** Enrichment rules **
	for _, ruleConfig := range destination.Enrichment {
		logging.Infof("[%s] %s", destinationID, ruleConfig.String())

		rule, err := enrichment.NewRule(ruleConfig)
		if err != nil {
			return nil, nil, fmt.Errorf("Error creating enrichment rule [%s]: %v", ruleConfig.String(), err)
		}

		enrichmentRules = append(enrichmentRules, rule)
	}

	// ** Mapping rules **
	if len(oldStyleMappings) > 0 {
		logging.Warnf("\n\t ** [%s] DEPRECATED mapping configuration. Read more about new configuration schema: https://jitsu.com/docs/configuration/schema-and-mappings **\n", destinationID)
		var convertErr error
		newStyleMapping, convertErr = schema.ConvertOldMappings(mappingFieldType, oldStyleMappings)
		if convertErr != nil {
			return nil, nil, convertErr
		}
	}
	enrichAndLogMappings(destinationID, destination.Type, newStyleMapping)
	fieldMapper, sqlTypes, err := schema.NewFieldMapper(newStyleMapping)
	if err != nil {
		return nil, nil, err
	}

	//retrospective users recognition
	var usersRecognitionConfiguration *UserRecognitionConfiguration
	var globalConfigurationLogMsg string
	if f.globalConfiguration.IsEnabled() {
		globalConfigurationLogMsg = " Global configuration will be used"
	}
	if destination.UsersRecognition != nil {
		err := destination.UsersRecognition.Validate()
		if err != nil {
			logging.Infof("[%s] invalid users recognition configuration: %v.%s", destinationID, err, globalConfigurationLogMsg)
		} else {
			usersRecognitionConfiguration = &UserRecognitionConfiguration{
				Enabled:                  destination.UsersRecognition.Enabled,
				AnonymousIDJSONPath:      jsonutils.NewJSONPath(destination.UsersRecognition.AnonymousIDNode),
				IdentificationJSONPathes: jsonutils.NewJSONPathes(destination.UsersRecognition.IdentificationNodes),
			}
		}
	} else {

		logging.Infof("[%s] users recognition isn't configured.%s", destinationID, globalConfigurationLogMsg)
	}

	//duplication data error warning
	//if global enabled or overridden enabled - check primary key fields
	//don't process user recognition in this case
	if (f.globalConfiguration.IsEnabled() || destination.UsersRecognition.IsEnabled()) && (destination.Type == PostgresType || destination.Type == RedshiftType) && len(pkFields) == 0 {
		logging.Errorf("[%s] retrospective users recognition is disabled: primary_key_fields must be configured (otherwise data duplication will occurred)", destinationID)
		usersRecognitionConfiguration = &UserRecognitionConfiguration{Enabled: false}
	}

	//Fields shouldn't been flattened in Facebook destination (requests has non-flat structure)
	var flattener schema.Flattener
	var typeResolver schema.TypeResolver
	if destination.Type == FacebookType {
		flattener = schema.NewDummyFlattener()
		typeResolver = schema.NewDummyTypeResolver()
	} else {
		flattener = schema.NewFlattener()
		typeResolver = schema.NewTypeResolver()
	}

	processor, err := schema.NewProcessor(destinationID, tableName, fieldMapper, enrichmentRules, flattener, typeResolver, destination.BreakOnError)
	if err != nil {
		return nil, nil, err
	}

	var eventQueue *events.PersistentQueue
	if destination.Mode == StreamMode {
		eventQueue, err = events.NewPersistentQueue(destinationID, "queue.dst="+destinationID, f.logEventPath)
		if err != nil {
			return nil, nil, err
		}
	}

	//override debug sql (ddl, queries) loggers from the destination config
	destinationLoggerFactory := f.globalLoggerFactory
	if destination.Log != nil {
		if destination.Log.DDL != nil {
			destinationLoggerFactory.NewFactoryWithDDLLogsWriter(logging.CreateLogWriter(&logging.Config{
				FileName:    appconfig.Instance.ServerName + "-" + logging.DDLLogerType,
				FileDir:     destination.Log.DDL.Path,
				RotationMin: destination.Log.DDL.RotationMin,
				MaxBackups:  destination.Log.DDL.MaxBackups}))
		}

		if destination.Log.Queries != nil {
			destinationLoggerFactory.NewFactoryWithQueryLogsWriter(logging.CreateLogWriter(&logging.Config{
				FileName:    appconfig.Instance.ServerName + "-" + logging.QueriesLoggerType,
				FileDir:     destination.Log.Queries.Path,
				RotationMin: destination.Log.Queries.RotationMin,
				MaxBackups:  destination.Log.Queries.MaxBackups}))
		}
	}

	storageConfig := &Config{
		ctx:              f.ctx,
		destinationID:    destinationID,
		destination:      &destination,
		usersRecognition: usersRecognitionConfiguration,
		processor:        processor,
		streamMode:       destination.Mode == StreamMode,
		maxColumns:       maxColumns,
		monitorKeeper:    f.monitorKeeper,
		eventQueue:       eventQueue,
		eventsCache:      f.eventsCache,
		loggerFactory:    destinationLoggerFactory,
		pkFields:         pkFields,
		sqlTypes:         sqlTypes,
	}

	storageProxy := newProxy(storageConstructor, storageConfig)

	return storageProxy, eventQueue, nil
}

//Add system fields as default mappings
//write current mapping configuration to logs
func enrichAndLogMappings(destinationID, destinationType string, mapping *schema.Mapping) {
	if mapping == nil || len(mapping.Fields) == 0 {
		logging.Warnf("[%s] doesn't have mapping rules", destinationID)
		return
	}

	keepUnmapped := true
	if mapping.KeepUnmapped != nil {
		keepUnmapped = *mapping.KeepUnmapped
	}

	//check system fields and add default mappings
	//if destination is SQL and not keep unmapped
	if isSQLType(destinationType) && !keepUnmapped {
		var configuredEventId, configuredTimestamp bool
		for _, f := range mapping.Fields {
			if f.Src == "/eventn_ctx/event_id" && (f.Dst == "/eventn_ctx/event_id" || f.Dst == "/eventn_ctx_event_id") {
				configuredEventId = true
			}

			if f.Src == "/_timestamp" && f.Dst == "/_timestamp" {
				configuredTimestamp = true
			}
		}

		if !configuredEventId {
			eventIdMapping := schema.MappingField{Src: "/eventn_ctx/event_id", Dst: "/eventn_ctx/event_id", Action: schema.MOVE}
			mapping.Fields = append(mapping.Fields, eventIdMapping)
			logging.Warnf("[%s] Added default system field mapping: %s", destinationID, eventIdMapping.String())
		}

		if !configuredTimestamp {
			eventIdMapping := schema.MappingField{Src: "/_timestamp", Dst: "/_timestamp", Action: schema.MOVE}
			mapping.Fields = append(mapping.Fields, eventIdMapping)
			logging.Warnf("[%s] Added default system field mapping: %s", destinationID, eventIdMapping.String())
		}
	}

	mappingMode := "keep unmapped fields"
	if !keepUnmapped {
		mappingMode = "remove unmapped fields"
	}
	logging.Infof("[%s] Configured field mapping rules with [%s] mode:", destinationID, mappingMode)

	for _, mappingRule := range mapping.Fields {
		logging.Infof("[%s] %s", destinationID, mappingRule.String())
	}
}

func isSQLType(destinationType string) bool {
	return destinationType == RedshiftType ||
		destinationType == BigQueryType ||
		destinationType == PostgresType ||
		destinationType == ClickHouseType ||
		destinationType == SnowflakeType ||
		//S3 can be SQL (S3 as intermediate layer)
		destinationType == S3Type
}
