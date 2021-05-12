package storages

import (
	"context"
	"errors"
	"fmt"
	"github.com/jitsucom/jitsu/server/jsonutils"
	"github.com/jitsucom/jitsu/server/meta"
	"strings"

	"github.com/jitsucom/jitsu/server/adapters"
	"github.com/jitsucom/jitsu/server/appconfig"
	"github.com/jitsucom/jitsu/server/caching"
	"github.com/jitsucom/jitsu/server/enrichment"
	"github.com/jitsucom/jitsu/server/events"
	"github.com/jitsucom/jitsu/server/identifiers"
	"github.com/jitsucom/jitsu/server/logging"
	"github.com/jitsucom/jitsu/server/schema"
	"github.com/jitsucom/jitsu/server/typing"
)

const (
	defaultTableName = "events"

	//BatchMode is a mode when destinaions store data with batches
	BatchMode = "batch"
	//StreamMode is a mode when destinaions store data row by row
	StreamMode = "stream"
)

var (
	//ErrUnknownDestination error for checking unknown destination type
	ErrUnknownDestination = errors.New("Unknown destination type")
	//StorageConstructors is used in all destinations init() methods
	StorageConstructors = make(map[string]func(*Config) (Storage, error))
)

//DestinationConfig is a destination configuration for serialization
type DestinationConfig struct {
	OnlyTokens           []string                 `mapstructure:"only_tokens" json:"only_tokens,omitempty" yaml:"only_tokens,omitempty"`
	Type                 string                   `mapstructure:"type" json:"type,omitempty" yaml:"type,omitempty"`
	Mode                 string                   `mapstructure:"mode" json:"mode,omitempty" yaml:"mode,omitempty"`
	DataLayout           *DataLayout              `mapstructure:"data_layout" json:"data_layout,omitempty" yaml:"data_layout,omitempty"`
	UsersRecognition     *UsersRecognition        `mapstructure:"users_recognition" json:"users_recognition,omitempty" yaml:"users_recognition,omitempty"`
	Enrichment           []*enrichment.RuleConfig `mapstructure:"enrichment" json:"enrichment,omitempty" yaml:"enrichment,omitempty"`
	Log                  *logging.SQLDebugConfig  `mapstructure:"log" json:"log,omitempty" yaml:"log,omitempty"`
	BreakOnError         bool                     `mapstructure:"break_on_error" json:"break_on_error,omitempty" yaml:"break_on_error,omitempty"`
	Staged               bool                     `mapstructure:"staged" json:"staged,omitempty" yaml:"staged,omitempty"`
	CachingConfiguration *CachingConfiguration    `mapstructure:"caching" json:"caching,omitempty" yaml:"caching,omitempty"`

	DataSource      *adapters.DataSourceConfig            `mapstructure:"datasource" json:"datasource,omitempty" yaml:"datasource,omitempty"`
	S3              *adapters.S3Config                    `mapstructure:"s3" json:"s3,omitempty" yaml:"s3,omitempty"`
	Google          *adapters.GoogleConfig                `mapstructure:"google" json:"google,omitempty" yaml:"google,omitempty"`
	GoogleAnalytics *adapters.GoogleAnalyticsConfig       `mapstructure:"google_analytics" json:"google_analytics,omitempty" yaml:"google_analytics,omitempty"`
	ClickHouse      *adapters.ClickHouseConfig            `mapstructure:"clickhouse" json:"clickhouse,omitempty" yaml:"clickhouse,omitempty"`
	Snowflake       *adapters.SnowflakeConfig             `mapstructure:"snowflake" json:"snowflake,omitempty" yaml:"snowflake,omitempty"`
	Facebook        *adapters.FacebookConversionAPIConfig `mapstructure:"facebook" json:"facebook,omitempty" yaml:"facebook,omitempty"`

	WebHook *adapters.WebHookConfig `mapstructure:"webhook" json:"webhook,omitempty" yaml:"webhook,omitempty"`
}

//DataLayout is used for configure mappings/table names and other data layout parameters
type DataLayout struct {
	//Deprecated
	MappingType schema.FieldMappingType `mapstructure:"mapping_type" json:"mapping_type,omitempty" yaml:"mapping_type,omitempty"`
	//Deprecated
	Mapping []string `mapstructure:"mapping" json:"mapping,omitempty" yaml:"mapping,omitempty"`

	Mappings          *schema.Mapping `mapstructure:"mappings" json:"mappings,omitempty" yaml:"mappings,omitempty"`
	MaxColumns        int             `mapstructure:"max_columns" json:"max_columns,omitempty" yaml:"max_columns,omitempty"`
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

//Config is a model for passing to destinations creator funcs
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
	uniqueIDField    *identifiers.UniqueID
	mappingsStyle    string
}

//RegisterStorage registers function to create new storage(destination) instance
func RegisterStorage(storageType string,
	createStorageFunc func(config *Config) (Storage, error)) {
	StorageConstructors[storageType] = createStorageFunc
}

//Factory is a destinations factory for creation
type Factory interface {
	Create(name string, destination DestinationConfig) (StorageProxy, *events.PersistentQueue, error)
}

//FactoryImpl is a destinations factory implementation
type FactoryImpl struct {
	ctx                 context.Context
	logEventPath        string
	monitorKeeper       MonitorKeeper
	eventsCache         *caching.EventsCache
	globalLoggerFactory *logging.Factory
	globalConfiguration *UsersRecognition
	metaStorage         meta.Storage
	maxColumns          int
}

//NewFactory returns configured Factory
func NewFactory(ctx context.Context, logEventPath string, monitorKeeper MonitorKeeper, eventsCache *caching.EventsCache,
	globalLoggerFactory *logging.Factory, globalConfiguration *UsersRecognition, metaStorage meta.Storage, maxColumns int) Factory {
	return &FactoryImpl{
		ctx:                 ctx,
		logEventPath:        logEventPath,
		monitorKeeper:       monitorKeeper,
		eventsCache:         eventsCache,
		globalLoggerFactory: globalLoggerFactory,
		globalConfiguration: globalConfiguration,
		metaStorage:         metaStorage,
		maxColumns:          maxColumns,
	}
}

//Create builds event storage proxy and event consumer (logger or event-queue)
//Enriches incoming configs with default values if needed
func (f *FactoryImpl) Create(destinationID string, destination DestinationConfig) (StorageProxy, *events.PersistentQueue, error) {
	if destination.Type == "" {
		destination.Type = destinationID
	}
	if destination.Mode == "" {
		destination.Mode = BatchMode
	}

	logging.Infof("[%s] initializing destination of type: %s in mode: %s", destinationID, destination.Type, destination.Mode)

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
	uniqueIDField := appconfig.Instance.GlobalUniqueIDField
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

		if destination.DataLayout.UniqueIDField != "" {
			uniqueIDField = identifiers.NewUniqueID(destination.DataLayout.UniqueIDField)
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
		logging.Infof("[%s] configured enrichment rules:", destinationID)
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
	enrichAndLogMappings(destinationID, destination.Type, uniqueIDField, newStyleMapping)
	fieldMapper, sqlTypes, err := schema.NewFieldMapper(newStyleMapping)
	if err != nil {
		return nil, nil, err
	}

	//** Retrospective users recognition **
	usersRecognition, err := f.initializeRetrospectiveUsersRecognition(destinationID, &destination, pkFields)
	if err != nil {
		return nil, nil, err
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

	processor, err := schema.NewProcessor(destinationID, tableName, fieldMapper, enrichmentRules, flattener, typeResolver, destination.BreakOnError, uniqueIDField)
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

	if destination.CachingConfiguration != nil && destination.CachingConfiguration.Disabled {
		logging.Infof("[%s] events caching is disabled", destinationID)
	}

	//for telemetry
	var mappingsStyle string
	if len(oldStyleMappings) > 0 {
		mappingsStyle = "old"
	} else if newStyleMapping != nil {
		mappingsStyle = "new"
	}

	storageConfig := &Config{
		ctx:              f.ctx,
		destinationID:    destinationID,
		destination:      &destination,
		usersRecognition: usersRecognition,
		processor:        processor,
		streamMode:       destination.Mode == StreamMode,
		maxColumns:       maxColumns,
		monitorKeeper:    f.monitorKeeper,
		eventQueue:       eventQueue,
		eventsCache:      f.eventsCache,
		loggerFactory:    destinationLoggerFactory,
		pkFields:         pkFields,
		sqlTypes:         sqlTypes,
		uniqueIDField:    uniqueIDField,
		mappingsStyle:    mappingsStyle,
	}

	storageProxy := newProxy(storageConstructor, storageConfig)

	return storageProxy, eventQueue, nil
}

//initializeRetrospectiveUsersRecognition initializes recognition configuration (overrides global one with destination layer)
//skip initialization if dummy meta storage
//disable destination configuration if Postgres or Redshift without primary keys
func (f *FactoryImpl) initializeRetrospectiveUsersRecognition(destinationID string, destination *DestinationConfig, pkFields map[string]bool) (*UserRecognitionConfiguration, error) {
	if f.metaStorage.Type() == meta.DummyType {
		if destination.UsersRecognition != nil {
			logging.Errorf("[%s] Users recognition requires 'meta.storage' configuration", destinationID)
		}
		return &UserRecognitionConfiguration{enabled: false}, nil
	}

	//validates or overrides with the global one
	if destination.UsersRecognition != nil {
		if err := destination.UsersRecognition.Validate(); err != nil {
			return nil, fmt.Errorf("Error validation destination users_recognition configuration: %v", err)
		}
	} else {
		destination.UsersRecognition = f.globalConfiguration
	}

	//disabled
	if !destination.UsersRecognition.IsEnabled() {
		return &UserRecognitionConfiguration{enabled: false}, nil
	}

	//check primary fields
	if (destination.Type == PostgresType || destination.Type == RedshiftType) && len(pkFields) == 0 {
		logging.Errorf("[%s] retrospective users recognition is disabled: primary_key_fields must be configured (otherwise data duplication will occurred)", destinationID)
		return &UserRecognitionConfiguration{enabled: false}, nil
	}

	logging.Infof("[%s] configured retrospective users recognition", destinationID)

	//check deprecated node
	if destination.UsersRecognition.UserIDNode != "" {
		logging.Warnf("[%s] users_recognition.user_id_node is deprecated. Please use users_recognition.identification_nodes instead. Read more about configuration: https://jitsu.com/docs/other-features/retrospective-user-recognition", destinationID)
		destination.UsersRecognition.IdentificationNodes = []string{destination.UsersRecognition.UserIDNode}
	}

	return &UserRecognitionConfiguration{
		enabled:                  destination.UsersRecognition.IsEnabled(),
		AnonymousIDJSONPath:      jsonutils.NewJSONPath(destination.UsersRecognition.AnonymousIDNode),
		IdentificationJSONPathes: jsonutils.NewJSONPaths(destination.UsersRecognition.IdentificationNodes),
	}, nil
}

//Add system fields as default mappings
//write current mapping configuration to logs
func enrichAndLogMappings(destinationID, destinationType string, uniqueIDField *identifiers.UniqueID, mapping *schema.Mapping) {
	if mapping == nil || len(mapping.Fields) == 0 {
		logging.Warnf("[%s] doesn't have mapping rules", destinationID)
		return
	}

	keepUnmapped := true
	if mapping.KeepUnmapped != nil {
		keepUnmapped = *mapping.KeepUnmapped
	}

	uniqueIDFieldName := uniqueIDField.GetFieldName()
	uniqueIDFieldFlatName := uniqueIDField.GetFlatFieldName()

	//check system fields and add default mappings
	//if destination is SQL and not keep unmapped
	if isSQLType(destinationType) && !keepUnmapped {
		var configuredEventId, configuredTimestamp bool
		for _, f := range mapping.Fields {
			if f.Src == uniqueIDFieldName && (f.Dst == uniqueIDFieldName || f.Dst == uniqueIDFieldFlatName) {
				configuredEventId = true
			}

			if f.Src == "/_timestamp" && f.Dst == "/_timestamp" {
				configuredTimestamp = true
			}
		}

		if !configuredEventId {
			eventIdMapping := schema.MappingField{Src: uniqueIDFieldName, Dst: uniqueIDFieldName, Action: schema.MOVE}
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
	logging.Infof("[%s] configured field mapping rules with [%s] mode:", destinationID, mappingMode)

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
