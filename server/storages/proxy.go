package storages

import (
	"github.com/jitsucom/eventnative/server/logging"
	"github.com/jitsucom/eventnative/server/safego"
	"sync"
	"time"
)

type RetryableProxy struct {
	sync.RWMutex
	factoryMethod func(*Config) (Storage, error)

	config  *Config
	storage Storage
	ready   bool
	closed  bool
}

func newProxy(factoryMethod func(*Config) (Storage, error), config *Config) StorageProxy {
	rsp := &RetryableProxy{factoryMethod: factoryMethod, config: config}
	rsp.start()
	return rsp
}

func (rsp *RetryableProxy) start() {
	safego.RunWithRestart(func() {
		for {
			if rsp.closed {
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

			logging.Infof("[%s] destination has been initialized!", rsp.config.name)

			break
		}
	}).WithRestartTimeout(1 * time.Minute)
}

func (rsp *RetryableProxy) Get() (Storage, bool) {
	rsp.RLock()
	defer rsp.RUnlock()
	return rsp.storage, rsp.ready
}

func (rsp *RetryableProxy) Close() error {
	rsp.closed = true
	if rsp.storage != nil {
		return rsp.storage.Close()
	}
	return nil
}
