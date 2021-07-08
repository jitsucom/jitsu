package storages

import (
	"errors"
	"fmt"
	"github.com/hashicorp/go-multierror"
	"github.com/jitsucom/jitsu/server/adapters"
	"github.com/jitsucom/jitsu/server/events"
	"github.com/jitsucom/jitsu/server/identifiers"
	"github.com/jitsucom/jitsu/server/schema"
)

//Amplitude is a destination that can send data into Amplitude
type Amplitude struct {
	Abstract

	tableHelper          *TableHelper
	streamingWorker      *StreamingWorker
	uniqueIDField        *identifiers.UniqueID
	staged               bool
	cachingConfiguration *CachingConfiguration
	amplitudeAdapter     *adapters.Amplitude
}

func init() {
	RegisterStorage(AmplitudeType, NewAmplitude)
}

//NewAmplitude returns configured Amplitude destination
func NewAmplitude(config *Config) (Storage, error) {
	if !config.streamMode {
		return nil, fmt.Errorf("Amplitude destination doesn't support %s mode", BatchMode)
	}

	amplitudeConfig := config.destination.Amplitude
	if err := amplitudeConfig.Validate(); err != nil {
		return nil, err
	}

	a := &Amplitude{
		uniqueIDField:        config.uniqueIDField,
		staged:               config.destination.Staged,
		cachingConfiguration: config.destination.CachingConfiguration,
	}

	requestDebugLogger := config.loggerFactory.CreateSQLQueryLogger(config.destinationID)
	aAdapter, err := adapters.NewAmplitude(amplitudeConfig, &adapters.HTTPAdapterConfiguration{
		DestinationID:  config.destinationID,
		Dir:            config.logEventPath,
		HTTPConfig:     DefaultHTTPConfiguration,
		PoolWorkers:    defaultWorkersPoolSize,
		DebugLogger:    requestDebugLogger,
		ErrorHandler:   a.ErrorEvent,
		SuccessHandler: a.SuccessEvent,
	})
	if err != nil {
		return nil, err
	}

	tableHelper := NewTableHelper(aAdapter, config.monitorKeeper, config.pkFields, adapters.DefaultSchemaTypeMappings, 0)

	a.tableHelper = tableHelper
	a.amplitudeAdapter = aAdapter

	//Abstract (SQLAdapters and tableHelpers are omitted)
	a.destinationID = config.destinationID
	a.processor = config.processor
	a.fallbackLogger = config.loggerFactory.CreateFailedLogger(config.destinationID)
	a.eventsCache = config.eventsCache
	a.archiveLogger = config.loggerFactory.CreateStreamingArchiveLogger(config.destinationID)

	//streaming worker (queue reading)
	a.streamingWorker = newStreamingWorker(config.eventQueue, config.processor, a, tableHelper)
	a.streamingWorker.start()

	return a, nil
}

//Insert sends event into adapters.HTTPAdapter
func (a *Amplitude) Insert(eventContext *adapters.EventContext) error {
	return a.amplitudeAdapter.Insert(eventContext)
}

func (a *Amplitude) DryRun(payload events.Event) ([]adapters.TableField, error) {
	return dryRun(payload, a.processor, a.tableHelper)
}

//Store isn't supported
func (a *Amplitude) Store(fileName string, objects []map[string]interface{}, alreadyUploadedTables map[string]bool) (map[string]*StoreResult, *events.FailedEvents, error) {
	return nil, nil, errors.New("Amplitude doesn't support Store() func")
}

//SyncStore isn't supported
func (a *Amplitude) SyncStore(overriddenDataSchema *schema.BatchHeader, objects []map[string]interface{}, timeIntervalValue string, cacheTable bool) error {
	return errors.New("Amplitude doesn't support Store() func")
}

//Update isn't supported
func (a *Amplitude) Update(object map[string]interface{}) error {
	return errors.New("Amplitude doesn't support Store() func")
}

//GetUsersRecognition returns users recognition configuration
func (a *Amplitude) GetUsersRecognition() *UserRecognitionConfiguration {
	return disabledRecognitionConfiguration
}

//GetUniqueIDField returns unique ID field configuration
func (a *Amplitude) GetUniqueIDField() *identifiers.UniqueID {
	return a.uniqueIDField
}

//IsCachingDisabled returns true if caching is disabled in destination configuration
func (a *Amplitude) IsCachingDisabled() bool {
	return a.cachingConfiguration != nil && a.cachingConfiguration.Disabled
}

//Type returns Amplitude type
func (a *Amplitude) Type() string {
	return AmplitudeType
}

func (a *Amplitude) IsStaging() bool {
	return a.staged
}

//Close closes Amplitude adapter, fallback logger and streaming worker
func (a *Amplitude) Close() (multiErr error) {
	if err := a.amplitudeAdapter.Close(); err != nil {
		multiErr = multierror.Append(multiErr, fmt.Errorf("[%s] Error closing Amplitude adapter: %v", a.ID(), err))
	}

	if a.streamingWorker != nil {
		if err := a.streamingWorker.Close(); err != nil {
			multiErr = multierror.Append(multiErr, fmt.Errorf("[%s] Error closing streaming worker: %v", a.ID(), err))
		}
	}

	if err := a.close(); err != nil {
		multiErr = multierror.Append(multiErr, err)
	}

	return
}
