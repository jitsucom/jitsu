package storages

import (
	"fmt"
	"github.com/jitsucom/jitsu/server/adapters"
	"github.com/jitsucom/jitsu/server/events"
	"github.com/jitsucom/jitsu/server/schema"
)

const (
	SourceSuccessEventType    = "SOURCE_SUCCESSFUL_RUN"
	DestinationBatchEventType = "DESTINATION_BATCH_RUN"

	dbtCloudTableNameFilter = "return ($.event_type == '" + SourceSuccessEventType + "' || $.event_type == '" + DestinationBatchEventType + "') ? true : false"
)

//DbtCloud is a destination that can send API request to cloud.getdbt.com
//It is not general purpose destination. It is designed for special kind of events like
//successful run of Source
type DbtCloud struct {
	HTTPStorage
	enabled bool
}

func init() {
	RegisterStorage(StorageType{typeName: DbtCloudType, createFunc: NewDbtCloud, defaultTableName: dbtCloudTableNameFilter, isSQL: false})
}

//NewDbtCloud returns configured DbtCloud destination
func NewDbtCloud(config *Config) (Storage, error) {
	if !config.streamMode {
		return nil, fmt.Errorf("DbtCloud destination doesn't support %s mode", BatchMode)
	}

	dbtCloudConfig := &adapters.DbtCloudConfig{}
	if err := config.destination.GetDestConfig(config.destination.DbtCloud, dbtCloudConfig); err != nil {
		return nil, err
	}

	dbt := &DbtCloud{enabled: dbtCloudConfig.Enabled}
	err := dbt.Init(config)
	if err != nil {
		return nil, err
	}
	requestDebugLogger := config.loggerFactory.CreateSQLQueryLogger(config.destinationID)
	dbtAdapter, err := adapters.NewDbtCloud(dbtCloudConfig, &adapters.HTTPAdapterConfiguration{
		DestinationID:  config.destinationID,
		Dir:            config.logEventPath,
		HTTPConfig:     DefaultHTTPConfiguration,
		QueueFactory:   config.queueFactory,
		PoolWorkers:    defaultWorkersPoolSize,
		DebugLogger:    requestDebugLogger,
		ErrorHandler:   dbt.ErrorEvent,
		SuccessHandler: dbt.SuccessEvent,
	})
	if err != nil {
		return nil, err
	}

	dbt.adapter = dbtAdapter

	//streaming worker (queue reading)
	dbt.streamingWorker = newStreamingWorker(config.eventQueue, dbt)

	return dbt, nil
}

//SyncStore isn't supported silently
func (dbt *DbtCloud) SyncStore(overriddenDataSchema *schema.BatchHeader, objects []map[string]interface{}, timeIntervalValue string, cacheTable bool, needCopyEvent bool) error {
	return nil
}

//Store isn't supported silently
func (dbt *DbtCloud) Store(fileName string, objects []map[string]interface{}, alreadyUploadedTables map[string]bool, needCopyEvent bool) (map[string]*StoreResult, *events.FailedEvents, *events.SkippedEvents, error) {
	return nil, nil, nil, nil
}

//Enabled returns whether we should use this storage
func (dbt *DbtCloud) Enabled() bool {
	return dbt.enabled
}

//Type returns WebHook type
func (dbt *DbtCloud) Type() string {
	return DbtCloudType
}
