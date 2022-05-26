package storages

import (
	"fmt"
	"github.com/jitsucom/jitsu/server/appconfig"
	"github.com/jitsucom/jitsu/server/enrichment"
	"github.com/jitsucom/jitsu/server/errorj"
	"github.com/jitsucom/jitsu/server/timestamp"
	"github.com/jitsucom/jitsu/server/typing"
	"math/rand"

	"github.com/jitsucom/jitsu/server/config"
	"github.com/jitsucom/jitsu/server/logging"

	"github.com/jitsucom/jitsu/server/identifiers"

	"github.com/hashicorp/go-multierror"
	"github.com/jitsucom/jitsu/server/adapters"
	"github.com/jitsucom/jitsu/server/caching"
	"github.com/jitsucom/jitsu/server/counters"
	"github.com/jitsucom/jitsu/server/events"
	"github.com/jitsucom/jitsu/server/metrics"
	"github.com/jitsucom/jitsu/server/schema"
	"github.com/jitsucom/jitsu/server/telemetry"
)

//Abstract is an Abstract destination storage
//contains common destination funcs
//aka abstract class
type Abstract struct {
	implementation Storage
	destinationID  string
	fallbackLogger logging.ObjectLogger
	eventsCache    *caching.EventsCache
	processor      *schema.Processor

	tableHelpers []*TableHelper
	sqlAdapters  []adapters.SQLAdapter
	sqlTypes     typing.SQLTypes

	uniqueIDField        *identifiers.UniqueID
	staged               bool
	cachingConfiguration *config.CachingConfiguration

	streamingWorker *StreamingWorker

	archiveLogger logging.ObjectLogger
}

//ID returns destination ID
func (a *Abstract) ID() string {
	return a.destinationID
}

// Processor returns processor
func (a *Abstract) Processor() *schema.Processor {
	return a.processor
}

func (a *Abstract) IsStaging() bool {
	return a.staged
}

//GetUniqueIDField returns unique ID field configuration
func (a *Abstract) GetUniqueIDField() *identifiers.UniqueID {
	return a.uniqueIDField
}

//IsCachingDisabled returns true if caching is disabled in destination configuration
func (a *Abstract) IsCachingDisabled() bool {
	return a.cachingConfiguration != nil && a.cachingConfiguration.Disabled
}

func (a *Abstract) DryRun(payload events.Event) ([][]adapters.TableField, error) {
	_, tableHelper := a.getAdapters()
	return dryRun(payload, a.processor, tableHelper)
}

//ErrorEvent writes error to metrics/counters/telemetry/events cache
func (a *Abstract) ErrorEvent(fallback bool, eventCtx *adapters.EventContext, err error) {
	metrics.ErrorTokenEvent(eventCtx.TokenID, a.Processor().DestinationType(), a.destinationID)
	counters.ErrorPushDestinationEvents(a.destinationID, 1)
	telemetry.Error(eventCtx.TokenID, a.destinationID, eventCtx.Src, "", 1)

	//cache
	a.eventsCache.Error(eventCtx.CacheDisabled, a.ID(), eventCtx.GetSerializedOriginalEvent(), err.Error())

	if fallback {
		a.Fallback(&events.FailedEvent{
			Event:   []byte(eventCtx.RawEvent.Serialize()),
			Error:   err.Error(),
			EventID: eventCtx.EventID,
		})
	}
}

//SuccessEvent writes success to metrics/counters/telemetry/events cache
func (a *Abstract) SuccessEvent(eventCtx *adapters.EventContext) {
	counters.SuccessPushDestinationEvents(a.destinationID, 1)
	telemetry.Event(eventCtx.TokenID, a.destinationID, eventCtx.Src, "", 1)
	metrics.SuccessTokenEvent(eventCtx.TokenID, a.Processor().DestinationType(), a.destinationID)

	//cache
	a.eventsCache.Succeed(eventCtx)
}

//SkipEvent writes skip to metrics/counters/telemetry and error to events cache
func (a *Abstract) SkipEvent(eventCtx *adapters.EventContext, err error) {
	counters.SkipPushDestinationEvents(a.destinationID, 1)
	metrics.SkipTokenEvent(eventCtx.TokenID, a.Processor().DestinationType(), a.destinationID)

	//cache
	a.eventsCache.Skip(eventCtx.CacheDisabled, a.destinationID, eventCtx.GetSerializedOriginalEvent(), err.Error())
}

//Fallback logs event with error to fallback logger
func (a *Abstract) Fallback(failedEvents ...*events.FailedEvent) {
	for _, failedEvent := range failedEvents {
		a.fallbackLogger.ConsumeAny(failedEvent)
	}
}

//Insert ensures table and sends input event to Destination (with 1 retry if error)
func (a *Abstract) Insert(eventContext *adapters.EventContext) (insertErr error) {
	defer func() {
		if !eventContext.RecognizedEvent {
			//metrics/counters/cache/fallback
			a.AccountResult(eventContext, insertErr)

			//archive
			if insertErr == nil {
				a.archiveLogger.Consume(eventContext.RawEvent, eventContext.TokenID)
			}
		}
	}()

	sqlAdapter, tableHelper := a.getAdapters()

	dbSchemaFromObject := eventContext.Table

	dbTable, err := tableHelper.EnsureTableWithCaching(a.ID(), eventContext.Table)
	if err != nil {
		//renew current db schema and retry
		return a.retryInsert(sqlAdapter, tableHelper, eventContext, dbSchemaFromObject)
	}

	eventContext.Table = dbTable

	err = sqlAdapter.Insert(adapters.NewSingleInsertContext(eventContext))
	if err != nil {
		//renew current db schema and retry
		return a.retryInsert(sqlAdapter, tableHelper, eventContext, dbSchemaFromObject)
	}

	return nil
}

//Store process events and stores with StoreTable() func
//returns store result per table, failed events (group of events which are failed to process) and err
func (a *Abstract) Store(fileName string, objects []map[string]interface{}, alreadyUploadedTables map[string]bool, needCopyEvent bool) (map[string]*StoreResult, *events.FailedEvents, *events.SkippedEvents, error) {
	flatData, recognizedFlatData, failedEvents, skippedEvents, err := a.processor.ProcessEvents(fileName, objects, alreadyUploadedTables, needCopyEvent)
	if err != nil {
		return nil, nil, nil, err
	}

	//update cache with failed events
	for _, failedEvent := range failedEvents.Events {
		if !failedEvent.RecognizedEvent {
			a.eventsCache.Error(a.IsCachingDisabled(), a.ID(), string(failedEvent.Event), failedEvent.Error)
		}
	}
	//update cache and counter with skipped events
	for _, skipEvent := range skippedEvents.Events {
		if !skipEvent.RecognizedEvent {
			a.eventsCache.Skip(a.IsCachingDisabled(), a.ID(), string(skipEvent.Event), skipEvent.Error)
		}
	}

	storeFailedEvents := true
	tableResults := map[string]*StoreResult{}
	for _, fdata := range flatData {
		table, err := a.implementation.storeTable(fdata)
		tableResults[table.Name] = &StoreResult{Err: err, RowsCount: fdata.GetPayloadLen(), EventsSrc: fdata.GetEventsPerSrc()}
		if err != nil {
			storeFailedEvents = false
		}

		if !fdata.RecognitionPayload {
			writeEventsToCache(a.implementation, a.eventsCache, table, fdata, err)
		}
	}
	for _, fdata := range recognizedFlatData {
		table, err := a.implementation.storeTable(fdata)
		if err != nil {
			logging.Errorf("Failed to store user recognition batch payload for %s table: %s err: %v", a.destinationID, table.Name, err)
		}
	}

	//store failed events to fallback only if other events have been inserted ok
	if storeFailedEvents {
		return tableResults, failedEvents, skippedEvents, nil
	}

	return tableResults, nil, skippedEvents, nil
}

//check table schema
//and store data into one table
func (a *Abstract) storeTable(fdata *schema.ProcessedFile) (*adapters.Table, error) {
	adapter, tableHelper := a.getAdapters()
	table := tableHelper.MapTableSchema(fdata.BatchHeader)
	dbSchema, err := tableHelper.EnsureTableWithoutCaching(a.ID(), table)
	if err != nil {
		return table, err
	}

	start := timestamp.Now()
	if err := adapter.Insert(adapters.NewBatchInsertContext(dbSchema, fdata.GetPayload(), nil)); err != nil {
		return dbSchema, err
	}
	logging.Debugf("[%s] Inserted [%d] rows in [%.2f] seconds", a.ID(), len(fdata.GetPayload()), timestamp.Now().Sub(start).Seconds())

	return dbSchema, nil
}

//Update updates record
func (a *Abstract) Update(eventContext *adapters.EventContext) error {
	sqlAdapter, tableHelper := a.getAdapters()
	processedObject := eventContext.ProcessedEvent
	table := eventContext.Table

	dbSchema, err := tableHelper.EnsureTableWithCaching(a.ID(), table)
	if err != nil {
		return err
	}

	start := timestamp.Now()
	if err = sqlAdapter.Update(dbSchema, processedObject, a.uniqueIDField.GetFlatFieldName(), a.uniqueIDField.Extract(processedObject)); err != nil {
		return err
	}

	logging.Debugf("[%s] Updated 1 row in [%.2f] seconds", a.ID(), timestamp.Now().Sub(start).Seconds())
	return nil
}

//retryInsert does retry if ensuring table or insert is failed
func (a *Abstract) retryInsert(sqlAdapter adapters.SQLAdapter, tableHelper *TableHelper, eventContext *adapters.EventContext,
	dbSchemaFromObject *adapters.Table) error {
	dbTable, err := tableHelper.RefreshTableSchema(a.ID(), dbSchemaFromObject)
	if err != nil {
		return errorj.Decorate(err, "failed to refresh table schema")
	}

	dbTable, err = tableHelper.EnsureTableWithCaching(a.ID(), dbSchemaFromObject)
	if err != nil {
		return errorj.Decorate(err, "failed to ensure table")
	}

	eventContext.Table = dbTable

	err = sqlAdapter.Insert(adapters.NewSingleInsertContext(eventContext))
	if err != nil {
		return errorj.Decorate(err, "failed to execute adapter insert")
	}

	return nil
}

//AccountResult checks input error and calls ErrorEvent or SuccessEvent
func (a *Abstract) AccountResult(eventContext *adapters.EventContext, err error) {
	if err != nil {
		if IsConnectionError(err) {
			a.ErrorEvent(false, eventContext, err)
		} else {
			a.ErrorEvent(true, eventContext, err)
		}
	} else {
		a.SuccessEvent(eventContext)
	}
}

//Clean removes all records from storage
func (a *Abstract) Clean(tableName string) error {
	return nil
}

func (a *Abstract) close() (multiErr error) {
	if a.streamingWorker != nil {
		if err := a.streamingWorker.Close(); err != nil {
			multiErr = multierror.Append(multiErr, fmt.Errorf("[%s] Error closing streaming worker: %v", a.ID(), err))
		}
	}
	if a.fallbackLogger != nil {
		if err := a.fallbackLogger.Close(); err != nil {
			multiErr = multierror.Append(multiErr, fmt.Errorf("[%s] Error closing fallback logger: %v", a.ID(), err))
		}
	}
	if a.archiveLogger != nil {
		if err := a.archiveLogger.Close(); err != nil {
			multiErr = multierror.Append(multiErr, fmt.Errorf("[%s] Error closing archive logger: %v", a.ID(), err))
		}
	}
	if a.processor != nil {
		a.processor.Close()
	}

	return nil
}

func (a *Abstract) Init(config *Config, impl Storage, preinstalledJavaScript string, defaultUserTransform string) error {
	a.implementation = impl
	//Abstract (SQLAdapters and tableHelpers are omitted)
	a.destinationID = config.destinationID
	a.eventsCache = config.eventsCache
	a.uniqueIDField = config.uniqueIDField
	a.staged = config.destination.Staged
	a.cachingConfiguration = config.destination.CachingConfiguration
	var err error
	a.processor, a.sqlTypes, err = a.setupProcessor(config)
	if err != nil {
		return err
	}
	if preinstalledJavaScript != "" {
		a.processor.AddJavaScript(preinstalledJavaScript)
	}
	if defaultUserTransform != "" {
		a.processor.SetDefaultUserTransform(defaultUserTransform)
	}
	return a.Processor().InitJavaScriptTemplates()
}

func (a *Abstract) Start(config *Config) error {
	a.fallbackLogger = config.loggerFactory.CreateFailedLogger(config.destinationID)
	a.archiveLogger = config.loggerFactory.CreateStreamingArchiveLogger(config.destinationID)

	if a.streamingWorker != nil {
		a.streamingWorker.start()
	}
	return nil
}

func (a *Abstract) setupProcessor(cfg *Config) (processor *schema.Processor, sqlTypes typing.SQLTypes, err error) {
	destination := cfg.destination
	destinationID := cfg.destinationID
	storageType, ok := StorageTypes[destination.Type]
	if !ok {
		return nil, nil, ErrUnknownDestination
	}
	var tableName string
	var oldStyleMappings []string
	var newStyleMapping *config.Mapping
	mappingFieldType := config.Default
	uniqueIDField := appconfig.Instance.GlobalUniqueIDField
	if destination.DataLayout != nil {
		mappingFieldType = destination.DataLayout.MappingType
		oldStyleMappings = destination.DataLayout.Mapping
		newStyleMapping = destination.DataLayout.Mappings
		if destination.DataLayout.TableNameTemplate != "" {
			tableName = destination.DataLayout.TableNameTemplate
		}
	}

	if tableName == "" {
		tableName = storageType.defaultTableName
	}
	if tableName == "" {
		tableName = defaultTableName
		logging.Infof("[%s] uses default table: %s", destinationID, tableName)
	}

	if len(destination.Enrichment) == 0 {
		logging.Warnf("[%s] doesn't have enrichment rules", destinationID)
	} else {
		logging.Infof("[%s] configured enrichment rules:", destinationID)
	}

	//default enrichment rules
	enrichmentRules := []enrichment.Rule{
		enrichment.CreateDefaultJsIPRule(cfg.geoService, destination.GeoDataResolverID),
		enrichment.DefaultJsUaRule,
		enrichment.DefaultAPIUaRule,
	}

	// ** Enrichment rules **
	for _, ruleConfig := range destination.Enrichment {
		logging.Infof("[%s] %s", destinationID, ruleConfig.String())

		rule, err := enrichment.NewRule(ruleConfig, cfg.geoService, destination.GeoDataResolverID)
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
	isSQLType := storageType.isSQLType(destination)
	enrichAndLogMappings(destinationID, isSQLType, uniqueIDField, newStyleMapping)
	fieldMapper, sqlTypes, err := schema.NewFieldMapper(newStyleMapping)
	if err != nil {
		return nil, nil, err
	}

	var flattener schema.Flattener
	var typeResolver schema.TypeResolver
	if isSQLType {
		flattener = schema.NewFlattener()
		typeResolver = schema.NewTypeResolver()
	} else {
		flattener = schema.NewDummyFlattener()
		typeResolver = schema.NewDummyTypeResolver()
	}

	maxColumnNameLength, _ := maxColumnNameLengthByDestinationType[destination.Type]
	mappingsStyle := ""
	if len(oldStyleMappings) > 0 {
		mappingsStyle = "old"
	} else if newStyleMapping != nil {
		mappingsStyle = "new"
	}
	processor, err = schema.NewProcessor(destinationID, destination, isSQLType, tableName, fieldMapper, enrichmentRules, flattener, typeResolver, uniqueIDField, maxColumnNameLength, mappingsStyle, cfg.usersRecognition.IsEnabled())
	if err != nil {
		return nil, nil, err
	}

	return processor, sqlTypes, nil
}

//assume that adapters quantity == tableHelpers quantity
func (a *Abstract) getAdapters() (adapters.SQLAdapter, *TableHelper) {
	num := rand.Intn(len(a.sqlAdapters))
	return a.sqlAdapters[num], a.tableHelpers[num]
}

func (a *Abstract) GetSyncWorker() *SyncWorker {
	return nil
}
