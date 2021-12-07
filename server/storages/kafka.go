package storages

import (
	"fmt"
	"github.com/hashicorp/go-multierror"
	"github.com/jitsucom/jitsu/server/adapters"
	"github.com/jitsucom/jitsu/server/events"
	"github.com/jitsucom/jitsu/server/logging"
	"github.com/jitsucom/jitsu/server/schema"
	"time"
)

//Kafka stores events to Confluent Kafka in stream mode
type Kafka struct {
	Abstract

	tableHelper     *TableHelper
	streamingWorker *StreamingWorker
	adapter         *adapters.Kafka
}

func init() {
	RegisterStorage(StorageType{typeName: KafkaType, createFunc: NewKafka})
}

func NewKafka(config *Config) (Storage, error) {
	kafkaConfig := config.destination.Kafka
	if err := kafkaConfig.Validate(); err != nil {
		return nil, err
	}

	kafkaAdapter, err := adapters.NewKafka(kafkaConfig)
	if err != nil {
		return nil, err
	}

	kafka := &Kafka{}

	tableHelper := NewTableHelper(kafkaAdapter, config.monitorKeeper, config.pkFields, adapters.SchemaToRedshift, config.maxColumns, KafkaType)

	kafka.adapter = kafkaAdapter

	//Abstract (SQLAdapters and tableHelpers are omitted)
	kafka.destinationID = config.destinationID
	kafka.processor = config.processor
	kafka.fallbackLogger = config.loggerFactory.CreateFailedLogger(config.destinationID)
	kafka.eventsCache = config.eventsCache
	kafka.archiveLogger = config.loggerFactory.CreateStreamingArchiveLogger(config.destinationID)
	kafka.uniqueIDField = config.uniqueIDField
	kafka.staged = config.destination.Staged
	kafka.cachingConfiguration = config.destination.CachingConfiguration

	//streaming worker (queue reading)
	kafka.streamingWorker = newStreamingWorker(config.eventQueue, config.processor, kafka, tableHelper)
	kafka.streamingWorker.start()

	return kafka, nil
}

// Insert passes event to kafka adapter
func (k *Kafka) Insert(eventContext *adapters.EventContext) (insertErr error) {
	//metrics/counters/cache/fallback
	defer func() {
		k.AccountResult(eventContext, insertErr)
	}()

	if err := k.adapter.Insert(eventContext); err != nil {
		insertErr = err
		return err
	}

	//archive
	k.archiveLogger.Consume(eventContext.RawEvent, eventContext.TokenID)

	return nil
}

// DryRun empty implementation
func (k *Kafka) DryRun(events.Event) ([][]adapters.TableField, error) {
	return nil, nil
}

//SyncStore produces messages to broker
func (k *Kafka) SyncStore(overriddenDataSchema *schema.BatchHeader, objects []map[string]interface{}, timeIntervalValue string, cacheTable bool) error {
	if len(objects) == 0 {
		return nil
	}

	flatDataPerTable, err := processData(k, overriddenDataSchema, objects, timeIntervalValue)
	if err != nil {
		return err
	}

	for _, flatData := range flatDataPerTable {
		table := k.tableHelper.MapTableSchema(flatData.BatchHeader)
		start := time.Now()
		if err = k.adapter.BulkInsert(table, flatData.GetPayload()); err != nil {
			return err
		}
		logging.Debugf("[%s] produced [%d] messages in [%.2f] seconds", k.ID(), flatData.GetPayloadLen(), time.Now().Sub(start).Seconds())
	}

	return nil
}

//Store produces messages to broker
func (k *Kafka) Store(fileName string, objects []map[string]interface{}, alreadyUploadedTables map[string]bool) (map[string]*StoreResult, *events.FailedEvents, *events.SkippedEvents, error) {
	flatData, failedEvents, skippedEvents, err := k.processor.ProcessEvents(fileName, objects, alreadyUploadedTables)
	if err != nil {
		return nil, nil, nil, err
	}

	//update cache with failed events
	for _, failedEvent := range failedEvents.Events {
		k.eventsCache.Error(k.IsCachingDisabled(), k.ID(), failedEvent.EventID, failedEvent.Error)
	}
	//update cache and counter with skipped events
	for _, skipEvent := range skippedEvents.Events {
		k.eventsCache.Skip(k.IsCachingDisabled(), k.ID(), skipEvent.EventID, skipEvent.Error)
	}

	storeFailedEvents := true
	tableResults := map[string]*StoreResult{}
	for _, fdata := range flatData {
		table := k.tableHelper.MapTableSchema(fdata.BatchHeader)
		err := k.adapter.BulkInsert(table, fdata.GetPayload())
		tableResults[table.Name] = &StoreResult{Err: err, RowsCount: fdata.GetPayloadLen(), EventsSrc: fdata.GetEventsPerSrc()}
		if err != nil {
			storeFailedEvents = false
		}

		//events cache
		for _, object := range fdata.GetPayload() {
			if err != nil {
				k.eventsCache.Error(k.IsCachingDisabled(), k.ID(), k.uniqueIDField.Extract(object), err.Error())
			} else {
				k.eventsCache.Succeed(&adapters.EventContext{
					CacheDisabled:  k.IsCachingDisabled(),
					DestinationID:  k.ID(),
					EventID:        k.uniqueIDField.Extract(object),
					ProcessedEvent: object,
					Table:          table,
				})
			}
		}
	}

	//store failed events to fallback only if other events have been inserted ok
	if storeFailedEvents {
		return tableResults, failedEvents, skippedEvents, nil
	}

	return tableResults, nil, skippedEvents, nil
}

//GetUsersRecognition returns disabled users recognition configuration
func (k *Kafka) GetUsersRecognition() *UserRecognitionConfiguration {
	return disabledRecognitionConfiguration
}

//Update isn't supported
func (k *Kafka) Update(_ map[string]interface{}) error {
	return fmt.Errorf("%s doesn't support Update() func", k.Type())
}

func (k *Kafka) Type() string {
	return KafkaType
}

// Close closes adapter and abstract storage
func (k *Kafka) Close() (multiErr error) {
	if err := k.adapter.Close(); err != nil {
		multiErr = multierror.Append(multiErr, fmt.Errorf("[%s] Error closing kafka adapter: %v", k.ID(), err))
	}
	if err := k.streamingWorker.Close(); err != nil {
		multiErr = multierror.Append(multiErr, fmt.Errorf("[%s] Error closing streaming worker: %v", k.ID(), err))
	}
	if err := k.close(); err != nil {
		multiErr = multierror.Append(multiErr, err)
	}
	return
}
