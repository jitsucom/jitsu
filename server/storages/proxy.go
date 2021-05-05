package storages

import (
	"github.com/jitsucom/jitsu/server/identifiers"
	"github.com/jitsucom/jitsu/server/logging"
	"github.com/jitsucom/jitsu/server/safego"
	"github.com/jitsucom/jitsu/server/telemetry"
	"sync"
	"time"
)

//RetryableProxy creates Storage with retry (if create fails e.g. because of connection issue)
type RetryableProxy struct {
	sync.RWMutex
	factoryMethod func(*Config) (Storage, error)

	config  *Config
	storage Storage
	ready   bool
	closed  bool
}

//newProxy return New RetryableProxy and starts goroutine
func newProxy(factoryMethod func(*Config) (Storage, error), config *Config) StorageProxy {
	rsp := &RetryableProxy{factoryMethod: factoryMethod, config: config}
	rsp.start()
	return rsp
}

//start runs a new goroutine for calling factoryMethod 1 time per 1 minute
func (rsp *RetryableProxy) start() {
	safego.RunWithRestart(func() {
		for {
			if rsp.closed {
				break
			}

			storage, err := rsp.factoryMethod(rsp.config)
			if err != nil {
				logging.Errorf("[%s] Error initializing destination of type %s: %v. Retry after 1 minute", rsp.config.destinationID, rsp.config.destination.Type, err)
				time.Sleep(1 * time.Minute)
				continue
			}

			rsp.Lock()
			rsp.storage = storage
			rsp.ready = true
			rsp.Unlock()

			logging.Infof("[%s] destination has been initialized!", rsp.config.destinationID)
			telemetry.Destination(rsp.config.destinationID, rsp.config.destination.Type, rsp.config.destination.Mode,
				rsp.config.mappingsStyle, len(rsp.config.pkFields) > 0, rsp.storage.GetUsersRecognition().IsEnabled())

			break
		}
	}).WithRestartTimeout(1 * time.Minute)
}

//Get returns underlying destination storage and ready flag
func (rsp *RetryableProxy) Get() (Storage, bool) {
	rsp.RLock()
	defer rsp.RUnlock()
	return rsp.storage, rsp.ready
}

//GetUniqueIDField returns unique ID field configuration
func (rsp *RetryableProxy) GetUniqueIDField() *identifiers.UniqueID {
	return rsp.config.uniqueIDField
}

//ID returns destination ID
func (rsp *RetryableProxy) ID() string {
	return rsp.config.destinationID
}

//Close stops underlying goroutine and close the storage
func (rsp *RetryableProxy) Close() error {
	rsp.closed = true
	if rsp.storage != nil {
		return rsp.storage.Close()
	}
	return nil
}
