package storages

import (
	"context"
	"errors"
	"fmt"
	"github.com/jitsucom/jitsu/server/config"
	"github.com/jitsucom/jitsu/server/geo"
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

	//BatchMode is a mode when destinations store data with batches
	BatchMode = "batch"
	//StreamMode is a mode when destinations store data row by row
	StreamMode = "stream"
)

var (
	//ErrUnknownDestination error for checking unknown destination type
	ErrUnknownDestination = errors.New("Unknown destination type")
	//StorageTypes is used in all destinations init() methods
	StorageTypes = make(map[string]StorageType)

	maxColumnNameLengthByDestinationType = map[string]int{
		RedshiftType:   115,
		MySQLType:      64,
		BigQueryType:   300,
		PostgresType:   59,
		SnowflakeType:  251,
		ClickHouseType: 251,
	}
)

//Config is a model for passing to destinations creator funcs
type Config struct {
	ctx                    context.Context
	destinationID          string
	destination            *config.DestinationConfig
	usersRecognition       *UserRecognitionConfiguration
	processor              *schema.Processor
	streamMode             bool
	maxColumns             int
	monitorKeeper          MonitorKeeper
	eventQueue             events.PersistentQueue
	eventsCache            *caching.EventsCache
	loggerFactory          *logging.Factory
	pkFields               map[string]bool
	sqlTypes               typing.SQLTypes
	uniqueIDField          *identifiers.UniqueID
	mappingsStyle          string
	logEventPath           string
	PostHandleDestinations []string
}

//RegisterStorage registers function to create new storage(destination) instance
func RegisterStorage(storageType StorageType) {
	StorageTypes[storageType.typeName] = storageType
}

//Factory is a destinations factory for creation
type Factory interface {
	Create(name string, destination config.DestinationConfig) (StorageProxy, events.PersistentQueue, error)
}

type StorageType struct {
	typeName         string
	createFunc       func(config *Config) (Storage, error)
	defaultTableName string
}

//FactoryImpl is a destination's factory implementation
type FactoryImpl struct {
	ctx                 context.Context
	logEventPath        string
	geoService          *geo.Service
	monitorKeeper       MonitorKeeper
	eventsCache         *caching.EventsCache
	globalLoggerFactory *logging.Factory
	globalConfiguration *config.UsersRecognition
	metaStorage         meta.Storage
	maxColumns          int
}

//NewFactory returns configured Factory
func NewFactory(ctx context.Context, logEventPath string, geoService *geo.Service, monitorKeeper MonitorKeeper, eventsCache *caching.EventsCache, globalLoggerFactory *logging.Factory, globalConfiguration *config.UsersRecognition, metaStorage meta.Storage, maxColumns int) Factory {
	return &FactoryImpl{
		ctx:                 ctx,
		logEventPath:        logEventPath,
		geoService:          geoService,
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
func (f *FactoryImpl) Create(destinationID string, destination config.DestinationConfig) (StorageProxy, events.PersistentQueue, error) {
	if destination.Type == "" {
		destination.Type = destinationID
	}
	if destination.Mode == "" {
		destination.Mode = BatchMode
	}

	logging.Infof("[%s] initializing destination of type: %s in mode: %s", destinationID, destination.Type, destination.Mode)

	storageType, ok := StorageTypes[destination.Type]
	if !ok {
		return nil, nil, ErrUnknownDestination
	}

	var tableName string
	var oldStyleMappings []string
	var newStyleMapping *config.Mapping
	pkFields := map[string]bool{}
	mappingFieldType := config.Default
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
		tableName = storageType.defaultTableName
	}
	if tableName == "" {
		tableName = defaultTableName
		logging.Infof("[%s] uses default table: %s", destinationID, tableName)

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
		enrichment.CreateDefaultJsIPRule(f.geoService, destination.GeoDataResolverID),
		enrichment.DefaultJsUaRule,
	}

	// ** Enrichment rules **
	for _, ruleConfig := range destination.Enrichment {
		logging.Infof("[%s] %s", destinationID, ruleConfig.String())

		rule, err := enrichment.NewRule(ruleConfig, f.geoService, destination.GeoDataResolverID)
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

	//** Retroactive users recognition **
	usersRecognition, err := f.initializeRetroactiveUsersRecognition(destinationID, &destination, pkFields)
	if err != nil {
		return nil, nil, err
	}

	//Fields shouldn't been flattened in Facebook destination (requests has non-flat structure)
	var flattener schema.Flattener
	var typeResolver schema.TypeResolver
	if needDummy(&destination) {
		flattener = schema.NewDummyFlattener()
		typeResolver = schema.NewDummyTypeResolver()
	} else {
		flattener = schema.NewFlattener()
		typeResolver = schema.NewTypeResolver()
	}

	maxColumnNameLength, _ := maxColumnNameLengthByDestinationType[destination.Type]

	processor, err := schema.NewProcessor(destinationID, &destination, tableName, fieldMapper, enrichmentRules, flattener, typeResolver, uniqueIDField, maxColumnNameLength)
	if err != nil {
		return nil, nil, err
	}

	eventQueue, err := events.NewPersistentQueue(destinationID, "queue.dst="+destinationID, f.logEventPath)
	if err != nil {
		return nil, nil, err
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
		ctx:                    f.ctx,
		destinationID:          destinationID,
		destination:            &destination,
		usersRecognition:       usersRecognition,
		processor:              processor,
		streamMode:             destination.Mode == StreamMode,
		maxColumns:             maxColumns,
		monitorKeeper:          f.monitorKeeper,
		eventQueue:             eventQueue,
		eventsCache:            f.eventsCache,
		loggerFactory:          destinationLoggerFactory,
		pkFields:               pkFields,
		sqlTypes:               sqlTypes,
		uniqueIDField:          uniqueIDField,
		mappingsStyle:          mappingsStyle,
		logEventPath:           f.logEventPath,
		PostHandleDestinations: destination.PostHandleDestinations,
	}

	storageProxy := newProxy(storageType.createFunc, storageConfig)

	return storageProxy, eventQueue, nil
}

func needDummy(destCfg *config.DestinationConfig) bool {
	if destCfg.Type == S3Type {
		fbConfig := &adapters.S3Config{}
		_ = destCfg.GetDestConfig(destCfg.S3, fbConfig)
		return fbConfig.Format == adapters.S3FormatJSON
	}
	return destCfg.Type == FacebookType || destCfg.Type == DbtCloudType || destCfg.Type == WebHookType ||
		destCfg.Type == AmplitudeType || destCfg.Type == HubSpotType
}

//initializeRetroactiveUsersRecognition initializes recognition configuration (overrides global one with destination layer)
//skip initialization if dummy meta storage
//disable destination configuration if Postgres or Redshift without primary keys
func (f *FactoryImpl) initializeRetroactiveUsersRecognition(destinationID string, destination *config.DestinationConfig, pkFields map[string]bool) (*UserRecognitionConfiguration, error) {
	if f.metaStorage.Type() == meta.DummyType {
		if destination.UsersRecognition != nil {
			logging.Errorf("[%s] Users recognition requires 'meta.storage' configuration", destinationID)
		}
		return &UserRecognitionConfiguration{enabled: false}, nil
	}

	//validates or overrides with the global one
	if destination.UsersRecognition != nil {
		//partly overriding
		if destination.UsersRecognition.UserIDNode == "" {
			destination.UsersRecognition.UserIDNode = f.globalConfiguration.UserIDNode
		}
		if len(destination.UsersRecognition.IdentificationNodes) == 0 {
			destination.UsersRecognition.IdentificationNodes = f.globalConfiguration.IdentificationNodes
		}
		if destination.UsersRecognition.AnonymousIDNode == "" {
			destination.UsersRecognition.AnonymousIDNode = f.globalConfiguration.AnonymousIDNode
		}
		if err := destination.UsersRecognition.Validate(); err != nil {
			return nil, fmt.Errorf("Error validating destination users_recognition configuration: %v", err)
		}
	} else {
		//completely overriding
		destination.UsersRecognition = f.globalConfiguration
	}

	//disabled
	if !destination.UsersRecognition.IsEnabled() {
		return &UserRecognitionConfiguration{enabled: false}, nil
	}

	//check primary fields
	if (destination.Type == PostgresType || destination.Type == RedshiftType || destination.Type == SnowflakeType) && len(pkFields) == 0 {
		logging.Errorf("[%s] retroactive users recognition is disabled: primary_key_fields must be configured (otherwise data duplication will occurred)", destinationID)
		return &UserRecognitionConfiguration{enabled: false}, nil
	}

	logging.Infof("[%s] configured retroactive users recognition", destinationID)

	//check deprecated node
	if destination.UsersRecognition.UserIDNode != "" {
		logging.Warnf("[%s] users_recognition.user_id_node is deprecated. Please use users_recognition.identification_nodes instead. Read more about configuration: https://jitsu.com/docs/other-features/retroactive-user-recognition", destinationID)
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
func enrichAndLogMappings(destinationID, destinationType string, uniqueIDField *identifiers.UniqueID, mapping *config.Mapping) {
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
			eventIdMapping := config.MappingField{Src: uniqueIDFieldName, Dst: uniqueIDFieldName, Action: config.MOVE}
			flatEventIdMapping := config.MappingField{Src: uniqueIDFieldFlatName, Dst: uniqueIDFieldFlatName, Action: config.MOVE}
			mapping.Fields = append(mapping.Fields, eventIdMapping, flatEventIdMapping)
			logging.Warnf("[%s] Added default system field mapping: %s", destinationID, eventIdMapping.String())
			logging.Warnf("[%s] Added default system field mapping: %s", destinationID, flatEventIdMapping.String())
		}

		if !configuredTimestamp {
			eventIdMapping := config.MappingField{Src: "/_timestamp", Dst: "/_timestamp", Action: config.MOVE}
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
