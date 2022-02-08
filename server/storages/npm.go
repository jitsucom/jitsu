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

	var jsTemplate *templates.V8TemplateExecutor

	if plugin.BuildInfo.SdkVersion != "" {
		jsTemplate, err = templates.NewV8TemplateExecutor(`return `+transformFuncName+`($)`, jsVariables, plugin.Code, `function `+transformFuncName+`($) { return exports.destination($, globalThis) }`)
	} else {
		//compatibility with old SDK
		for k, v := range config.destination.Config {
			jsVariables[k] = v
		}
		jsTemplate, err = templates.NewV8TemplateExecutor(`return `+transformFuncName+`($)`, jsVariables, plugin.Code, `function `+transformFuncName+`($) { return exports.adapter($, globalThis) }`)
	}

	if err != nil {
		return nil, fmt.Errorf("failed to init builtin javascript code: %v", err)
	}
	wh := &NpmDestination{}
	err = wh.Init(config)
	if err != nil {
		return nil, err
	}
	wh.processor.SetBuiltinTransformer(jsTemplate)

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

	wh.adapter = wbAdapter

	//streaming worker (queue reading)
	wh.streamingWorker = newStreamingWorker(config.eventQueue, wh)
	return wh, nil
}

//Type returns NpmType type
func (wh *NpmDestination) Type() string {
	return NpmType
}
