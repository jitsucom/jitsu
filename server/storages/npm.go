package storages

import (
	"fmt"

	"github.com/jitsucom/jitsu/server/adapters"
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
func NewNpmDestination(config *Config) (storage Storage, err error) {
	defer func() {
		if err != nil && storage != nil {
			storage.Close()
			storage = nil
		}
	}()

	if !config.streamMode {
		return nil, fmt.Errorf("NpmDestination destination doesn't support %s mode", BatchMode)
	}

	jsTemplate, err := templates.NewScriptExecutor(&templates.DestinationPlugin{
		Package: config.destination.Package,
		ID:      config.destinationID,
		Type:    NpmType,
		Config:  config.destination.Config,
	}, nil)

	if err != nil {
		return nil, fmt.Errorf("failed to init builtin javascript code: %v", err)
	}

	defer func() {
		if err != nil {
			jsTemplate.Close()
		}
	}()

	wh := &NpmDestination{}
	err = wh.Init(config, wh, "", "")
	if err != nil {
		return
	}

	storage = wh
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
		return
	}

	wh.adapter = wbAdapter

	//streaming worker (queue reading)
	wh.streamingWorker = newStreamingWorker(config.eventQueue, wh)
	return
}

//Type returns NpmType type
func (wh *NpmDestination) Type() string {
	return NpmType
}
