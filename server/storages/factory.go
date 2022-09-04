package storages

import (
	"context"
	"errors"
	"fmt"
	"strings"

	"github.com/jitsucom/jitsu/server/appconfig"
	"github.com/jitsucom/jitsu/server/caching"
	"github.com/jitsucom/jitsu/server/config"
	"github.com/jitsucom/jitsu/server/coordination"
	"github.com/jitsucom/jitsu/server/events"
	"github.com/jitsucom/jitsu/server/geo"
	"github.com/jitsucom/jitsu/server/identifiers"
	"github.com/jitsucom/jitsu/server/jsonutils"
	"github.com/jitsucom/jitsu/server/logevents"
	"github.com/jitsucom/jitsu/server/logging"
	"github.com/jitsucom/jitsu/server/meta"
)

const (
	defaultTableName = "events"

	//BatchMode is a mode when destinations store data with batches
	BatchMode = "batch"
	//StreamMode is a mode when destinations store data row by row
	StreamMode = "stream"
	//SynchronousMode is a mode when destinations process event immediately during HTTP request lifetime and can put result in HTTP response body
	SynchronousMode = "synchronous"
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
	geoService             *geo.Service
	streamMode             bool
	maxColumns             int
	coordinationService    *coordination.Service
	eventQueue             events.Queue
	eventsCache            *caching.EventsCache
	loggerFactory          *logevents.Factory
	queueFactory           *events.QueueFactory
	pkFields               map[string]bool
	uniqueIDField          *identifiers.UniqueID
	logEventPath           string
	PostHandleDestinations []string
}

//RegisterStorage registers function to create new storage(destination) instance
func RegisterStorage(storageType StorageType) {
	StorageTypes[storageType.typeName] = storageType
}

//Factory is a destinations factory for creation
type Factory interface {
	Create(name string, destination config.DestinationConfig) (StorageProxy, events.Queue, error)
	Configure(destinationID string, destination config.DestinationConfig) (func(config *Config) (Storage, error), *Config, error)
}

type StorageType struct {
	typeName         string
	createFunc       func(config *Config) (Storage, error)
	defaultTableName string
	IsSynchronous    bool
	isSQL            bool
	isSQLFunc        func(config *config.DestinationConfig) bool
}

func (storageType StorageType) isSQLType(destCfg *config.DestinationConfig) bool {
	if storageType.isSQLFunc != nil {
		return storageType.isSQLFunc(destCfg)
	}
	return storageType.isSQL
}

//FactoryImpl is a destination's factory implementation
type FactoryImpl struct {
	ctx                 context.Context
	logEventPath        string
	geoService          *geo.Service
	coordinationService *coordination.Service
	eventsCache         *caching.EventsCache
	globalLoggerFactory *logevents.Factory
	globalConfiguration *config.UsersRecognition
	metaStorage         meta.Storage
	eventsQueueFactory  *events.QueueFactory
	maxColumns          int
}

//NewFactory returns configured Factory
func NewFactory(ctx context.Context, logEventPath string, geoService *geo.Service, coordinationService *coordination.Service,
	eventsCache *caching.EventsCache, globalLoggerFactory *logevents.Factory, globalConfiguration *config.UsersRecognition,
	metaStorage meta.Storage, eventsQueueFactory *events.QueueFactory, maxColumns int) Factory {
	return &FactoryImpl{
		ctx:                 ctx,
		logEventPath:        logEventPath,
		geoService:          geoService,
		coordinationService: coordinationService,
		eventsCache:         eventsCache,
		globalLoggerFactory: globalLoggerFactory,
		globalConfiguration: globalConfiguration,
		metaStorage:         metaStorage,
		eventsQueueFactory:  eventsQueueFactory,
		maxColumns:          maxColumns,
	}
}

//Create builds event storage proxy and event consumer (logger or event-queue)
//Enriches incoming configs with default values if needed
func (f *FactoryImpl) Create(destinationID string, destination config.DestinationConfig) (StorageProxy, events.Queue, error) {
	createFunc, config, err := f.Configure(destinationID, destination)
	if err != nil {
		return nil, nil, err
	}
	storageProxy := newProxy(createFunc, config)
	return storageProxy, config.eventQueue, nil
}

func (f *FactoryImpl) Configure(destinationID string, destination config.DestinationConfig) (func(config *Config) (Storage, error), *Config, error) {
	if destination.Type == "" {
		destination.Type = destinationID
	}
	if destination.Mode == "" {
		destination.Mode = BatchMode
	}
	if destination.Mode != BatchMode && destination.Mode != StreamMode && destination.Mode != SynchronousMode {
		return nil, nil, fmt.Errorf("Unknown destination mode: %s. Available mode: [%s, %s, %s]", destination.Mode, BatchMode, StreamMode, SynchronousMode)
	}
	logging.Infof("[%s] initializing destination of type: %s", destinationID, destination.Type)
	storageType, ok := StorageTypes[destination.Type]
	if storageType.IsSynchronous {
		destination.Mode = SynchronousMode
	}
	if !ok {
		return nil, nil, ErrUnknownDestination
	}
	logging.Infof("[%s] destination mode: %s", destinationID, destination.Mode)

	pkFields := map[string]bool{}
	maxColumns := f.maxColumns
	streamingRetryDelay := appconfig.Instance.StreamingRetryDelay
	errorRetryPeriod := appconfig.Instance.ErrorRetryPeriod
	uniqueIDField := appconfig.Instance.GlobalUniqueIDField
	if destination.DataLayout != nil {
		for _, field := range destination.DataLayout.PrimaryKeyFields {
			pkFields[field] = true
		}
		if destination.DataLayout.MaxColumns > 0 {
			maxColumns = destination.DataLayout.MaxColumns
			logging.Infof("[%s] uses max_columns setting: %d", destinationID, maxColumns)
		}
		if destination.DataLayout.ErrorRetryPeriod > 0 {
			errorRetryPeriod = destination.DataLayout.ErrorRetryPeriod
			logging.Infof("[%s] uses error_retry_period_hours setting: %d", destinationID, errorRetryPeriod)
		}
		if destination.DataLayout.UniqueIDField != "" {
			uniqueIDField = identifiers.NewUniqueID(destination.DataLayout.UniqueIDField)
		}
	}
	if len(pkFields) > 0 {
		logging.Infof("[%s] has primary key fields: [%s]", destinationID, strings.Join(destination.DataLayout.PrimaryKeyFields, ", "))
	} else {
		logging.Infof("[%s] doesn't have primary key fields", destinationID)
	}

	//** Retroactive users recognition **
	usersRecognition, err := f.initializeRetroactiveUsersRecognition(destinationID, &destination, pkFields)
	if err != nil {
		return nil, nil, err
	}

	var eventQueue events.Queue
	if destination.Mode != SynchronousMode {
		eventQueue, err = f.eventsQueueFactory.CreateEventsQueue(destination.Type, destinationID, streamingRetryDelay, errorRetryPeriod)
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

	storageConfig := &Config{
		ctx:                    f.ctx,
		destinationID:          destinationID,
		destination:            &destination,
		usersRecognition:       usersRecognition,
		geoService:             f.geoService,
		streamMode:             destination.Mode == StreamMode,
		maxColumns:             maxColumns,
		coordinationService:    f.coordinationService,
		eventQueue:             eventQueue,
		eventsCache:            f.eventsCache,
		loggerFactory:          destinationLoggerFactory,
		queueFactory:           f.eventsQueueFactory,
		pkFields:               pkFields,
		uniqueIDField:          uniqueIDField,
		logEventPath:           f.logEventPath,
		PostHandleDestinations: destination.PostHandleDestinations,
	}
	return storageType.createFunc, storageConfig, nil
}

//initializeRetroactiveUsersRecognition initializes recognition configuration (overrides global one with destination layer)
//skip initialization if dummy meta storage
//disable destination configuration if Postgres or Redshift without primary keys
func (f *FactoryImpl) initializeRetroactiveUsersRecognition(destinationID string, destination *config.DestinationConfig, pkFields map[string]bool) (*UserRecognitionConfiguration, error) {
	if f.metaStorage.Type() == meta.DummyType {
		if destination.UsersRecognition != nil {
			logging.Errorf("[%s] Users recognition requires 'meta.storage' configuration", destinationID)
		}
		return &UserRecognitionConfiguration{Enabled: false}, nil
	}

	URSetup, ok := UserRecognitionStorages[destination.Type]
	if !ok {
		return &UserRecognitionConfiguration{Enabled: false}, nil
	}

	//validates or overrides with the global one
	if destination.UsersRecognition != nil {
		if destination.UsersRecognition.IsEnabled() && !f.globalConfiguration.IsEnabled() {
			return nil, fmt.Errorf("Error enabling user recognition for destination %s. Global user recognition configuration must be enabled first. Please add global user_recognition.enabled: true", destinationID)
		}
		//partly overriding
		if destination.UsersRecognition.UserIDNode != "" ||
			len(destination.UsersRecognition.IdentificationNodes) > 0 ||
			destination.UsersRecognition.AnonymousIDNode != "" {
			logging.Errorf("@@@@ [%s] Configuring Users Recognition ID nodes no longer supported on destination level!\n@@@@ Please set id nodes on global level: https://jitsu.com/docs/other-features/retroactive-user-recognition", destinationID)
		}
		destination.UsersRecognition.UserIDNode = f.globalConfiguration.UserIDNode
		destination.UsersRecognition.IdentificationNodes = f.globalConfiguration.IdentificationNodes
		destination.UsersRecognition.AnonymousIDNode = f.globalConfiguration.AnonymousIDNode
	} else {
		//completely overriding
		destination.UsersRecognition = f.globalConfiguration
	}

	//disabled
	if !destination.UsersRecognition.IsEnabled() {
		return &UserRecognitionConfiguration{Enabled: false}, nil
	}

	//check primary fields
	if URSetup.PKRequired && len(pkFields) == 0 {
		logging.Errorf("[%s] Retroactive Users Recognition was DISABLED: primary_key_fields must be configured (otherwise data duplication will occurred)", destinationID)
		return &UserRecognitionConfiguration{Enabled: false}, nil
	}

	logging.Infof("[%s] configured retroactive users recognition", destinationID)

	//check deprecated node
	if destination.UsersRecognition.UserIDNode != "" {
		logging.Warnf("[%s] users_recognition.user_id_node is deprecated. Please use users_recognition.identification_nodes instead. Read more about configuration: https://jitsu.com/docs/other-features/retroactive-user-recognition", destinationID)
		destination.UsersRecognition.IdentificationNodes = []string{destination.UsersRecognition.UserIDNode}
	}

	return &UserRecognitionConfiguration{
		Enabled:                  destination.UsersRecognition.IsEnabled(),
		AnonymousIDJSONPath:      jsonutils.NewJSONPath(destination.UsersRecognition.AnonymousIDNode),
		IdentificationJSONPathes: jsonutils.NewJSONPaths(destination.UsersRecognition.IdentificationNodes),
	}, nil
}

//Add system fields as default mappings
//write current mapping configuration to logs
func enrichAndLogMappings(destinationID string, isSQL bool, uniqueIDField *identifiers.UniqueID, mapping *config.Mapping) {
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
	if isSQL && !keepUnmapped {
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
