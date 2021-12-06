package storages

import (
	"fmt"
	"github.com/iancoleman/strcase"
	"github.com/jitsucom/jitsu/server/adapters"
	"github.com/jitsucom/jitsu/server/plugins"
)

type NpmDestination struct {
	WebHook
}

func init() {
	RegisterStorage(StorageType{typeName: NpmType, createFunc: NewNpmDestination})
}

//NewNpmDestination returns configured NpmDestination
func NewNpmDestination(config *Config) (Storage, error) {
	if !config.streamMode {
		return nil, fmt.Errorf("NpmDestination destination doesn't support %s mode", BatchMode)
	}

	plugin, err := plugins.DownloadPlugin(config.destination.Package)
	if err != nil {
		return nil, err
	}

	transformFuncName := strcase.ToLowerCamel("to_" + plugin.Name)
	config.processor.AddJavaScript(plugin.Code)
	config.processor.AddJavaScript(`function ` + transformFuncName + `($) { return exports.adapter($, globalThis) }`)
	config.processor.AddJavaScriptVariables(config.destination.Config)
	config.processor.SetDefaultTransform(`return ` + transformFuncName + `($)`)

	wh := WebHook{}
	requestDebugLogger := config.loggerFactory.CreateSQLQueryLogger(config.destinationID)
	wbAdapter, err := adapters.NewNpm(&adapters.HTTPAdapterConfiguration{
		DestinationID:  config.destinationID,
		Dir:            config.logEventPath,
		HTTPConfig:     DefaultHTTPConfiguration,
		QueueFactory:   config.queueFactory,
		PoolWorkers:    defaultWorkersPoolSize,
		DebugLogger:    requestDebugLogger,
		ErrorHandler:   wh.ErrorEvent,
		SuccessHandler: wh.SuccessEvent,
	})
	if err != nil {
		return nil, err
	}

	tableHelper := NewTableHelper(wbAdapter, config.monitorKeeper, config.pkFields, adapters.DefaultSchemaTypeMappings, 0, WebHookType)

	wh.tableHelper = tableHelper
	wh.adapter = wbAdapter

	//Abstract (SQLAdapters and tableHelpers are omitted)
	wh.destinationID = config.destinationID
	wh.processor = config.processor
	wh.fallbackLogger = config.loggerFactory.CreateFailedLogger(config.destinationID)
	wh.eventsCache = config.eventsCache
	wh.archiveLogger = config.loggerFactory.CreateStreamingArchiveLogger(config.destinationID)
	wh.uniqueIDField = config.uniqueIDField
	wh.staged = config.destination.Staged
	wh.cachingConfiguration = config.destination.CachingConfiguration

	//streaming worker (queue reading)
	wh.streamingWorker = newStreamingWorker(config.eventQueue, config.processor, &wh, tableHelper)
	wh.streamingWorker.start()

	return &NpmDestination{wh}, nil
}

//Type returns NpmType type
func (wh *NpmDestination) Type() string {
	return NpmType
}
