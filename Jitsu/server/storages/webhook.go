package storages

import (
	"fmt"
	"math"
	"net/http"
	"time"

	"github.com/jitsucom/jitsu/server/adapters"
)

const defaultWorkersPoolSize = 10

// DefaultHTTPConfiguration contains default HTTP timeouts/retry/delays,etc for HTTPAdapters
var DefaultHTTPConfiguration = &adapters.HTTPConfiguration{
	GlobalClientTimeout:       10 * time.Second,
	RetryDelay:                10 * time.Second,
	RetryCount:                9,
	ClientMaxIdleConns:        1000,
	ClientMaxIdleConnsPerHost: 1000,
	QueueFullnessThreshold:    100_000, //assume that JSON event consumes 2KB => inmemory queue will max 200MB
}

// WebHook is a destination that can send configurable HTTP requests
type WebHook struct {
	HTTPStorage
}

func init() {
	RegisterStorage(StorageType{typeName: WebHookType, createFunc: NewWebHook, isSQL: false})
}

// NewWebHook returns configured WebHook destination
func NewWebHook(config *Config) (storage Storage, err error) {
	defer func() {
		if err != nil && storage != nil {
			storage.Close()
			storage = nil
		}
	}()
	if !config.streamMode {
		return nil, fmt.Errorf("WebHook destination doesn't support %s mode", BatchMode)
	}

	webHookConfig := &adapters.WebHookConfig{}
	if err = config.destination.GetDestConfig(config.destination.WebHook, webHookConfig); err != nil {
		return nil, err
	}

	//default GET HTTP method
	if webHookConfig.Method == "" {
		webHookConfig.Method = http.MethodGet
	}

	if webHookConfig.Headers == nil {
		webHookConfig.Headers = map[string]string{}
	}

	wh := &WebHook{}
	err = wh.Init(config, wh, "", "")
	if err != nil {
		return
	}
	storage = wh

	requestDebugLogger := config.loggerFactory.CreateSQLQueryLogger(config.destinationID)
	wbAdapter, err := adapters.NewWebHook(webHookConfig, &adapters.HTTPAdapterConfiguration{
		DestinationID:  config.destinationID,
		Dir:            config.logEventPath,
		HTTPConfig:     DefaultHTTPConfiguration,
		QueueFactory:   config.queueFactory,
		PoolWorkers:    int(math.Max(defaultWorkersPoolSize, float64(config.streamingThreadsCount))),
		DebugLogger:    requestDebugLogger,
		ErrorHandler:   wh.ErrorEvent,
		SuccessHandler: wh.SuccessEvent,
	})
	if err != nil {
		return
	}

	wh.adapter = wbAdapter

	//streaming worker (queue reading)
	wh.streamingWorkers = newStreamingWorkers(config.eventQueue, wh, config.streamingThreadsCount)

	return
}

// Type returns WebHook type
func (wh *WebHook) Type() string {
	return WebHookType
}
