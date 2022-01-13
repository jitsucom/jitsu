package storages

import (
	"fmt"
	"github.com/iancoleman/strcase"
	"github.com/jitsucom/jitsu/server/adapters"
	"github.com/jitsucom/jitsu/server/plugins"
	"github.com/jitsucom/jitsu/server/templates"
)

type NpmDestination struct {
	WebHook
}

type NpmValidatorResult struct {
	Ok      bool   `mapstructure:"ok"`
	Message string `mapstructure:"message"`
}

func init() {
	RegisterStorage(StorageType{typeName: NpmType, createFunc: NewNpmDestination, isSQL: false})
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
	jsVariables := make(map[string]interface{})
	jsVariables["destinationId"] = config.destinationID
	jsVariables["destinationType"] = NpmType
	jsVariables["config"] = config.destination.Config
	jsTemplate, err := templates.NewV8TemplateExecutor(`return `+transformFuncName+`($)`, jsVariables, plugin.Code, `function `+transformFuncName+`($) { return exports.destination($, globalThis) }`)
	if err != nil {
		return nil, fmt.Errorf("failed to init builtin javascript code: %v", err)
	}
	config.processor.SetBuiltinTransformer(jsTemplate)

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

	tableHelper := NewTableHelper("", wbAdapter, config.monitorKeeper, config.pkFields, adapters.DefaultSchemaTypeMappings, 0, WebHookType)

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
	wh.streamingWorker, err = newStreamingWorker(config.eventQueue, config.processor, &wh, tableHelper)
	if err != nil {
		return nil, err
	}
	wh.streamingWorker.start()

	return &NpmDestination{wh}, nil
}

//Type returns NpmType type
func (wh *NpmDestination) Type() string {
	return NpmType
}
