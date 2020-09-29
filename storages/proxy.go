package storages

import (
	"github.com/ksensehq/eventnative/appstatus"
	"github.com/ksensehq/eventnative/events"
	"github.com/ksensehq/eventnative/logging"
	"sync"
	"time"
)

type RetryableProxy struct {
	sync.RWMutex
	factoryMethod func(config *Config) (events.Storage, error)

	config  *Config
	storage events.Storage
	ready   bool
}

func newProxy(factoryMethod func(config *Config) (events.Storage, error), config *Config) events.StorageProxy {
	rsp := &RetryableProxy{factoryMethod: factoryMethod, config: config}
	go rsp.start()
	return rsp
}

func (rsp *RetryableProxy) start() {
	go func() {
		for {
			if appstatus.Instance.Idle {
				break
			}

			storage, err := rsp.factoryMethod(rsp.config)
			if err != nil {
				logging.Errorf("[%s] Error initializing destination of type %s: %v. Retry after 1 minute", rsp.config.name, rsp.config.destination.Type, err)
				time.Sleep(1 * time.Minute)
				continue
			}

			rsp.Lock()
			rsp.storage = storage
			rsp.ready = true
			rsp.Unlock()

			logging.Infof("[%s] has been initialized!", rsp.config.name)

			break
		}
	}()
}

func (rsp *RetryableProxy) Get() (events.Storage, bool) {
	rsp.RLock()
	defer rsp.RUnlock()
	return rsp.storage, rsp.ready
}

func (rsp *RetryableProxy) Close() error {
	if rsp.storage != nil {
		return rsp.storage.Close()
	}
	return nil
}
