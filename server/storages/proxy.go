package storages

import (
	"github.com/jitsucom/jitsu/server/identifiers"
	"github.com/jitsucom/jitsu/server/logging"
	"github.com/jitsucom/jitsu/server/safego"
	"github.com/jitsucom/jitsu/server/telemetry"
	"go.uber.org/atomic"
	"sync"
	"time"
)

//RetryableProxy creates Storage with retry (if create fails e.g. because of connection issue)
type RetryableProxy struct {
	sync.RWMutex
	factoryMethod func(*Config) (Storage, error)

	config  *Config
	storage Storage
	ready   *atomic.Bool
	closed  *atomic.Bool
}

//newProxy return New RetryableProxy and starts goroutine
func newProxy(factoryMethod func(*Config) (Storage, error), config *Config) StorageProxy {
	rsp := &RetryableProxy{
		factoryMethod: factoryMethod,
		config:        config,
		ready:         atomic.NewBool(false),
		closed:        atomic.NewBool(false),
	}
	rsp.start()
	return rsp
}

//start runs a new goroutine for calling factoryMethod 1 time per 1 minute
func (rsp *RetryableProxy) start() {
	safego.RunWithRestart(func() {
		for {
			if rsp.closed.Load() {
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
			rsp.ready.Store(true)
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
	return rsp.storage, rsp.ready.Load()
}

//GetUniqueIDField returns unique ID field configuration
func (rsp *RetryableProxy) GetUniqueIDField() *identifiers.UniqueID {
	return rsp.config.uniqueIDField
}

//ID returns destination ID
func (rsp *RetryableProxy) ID() string {
	return rsp.config.destinationID
}

//Type returns destination type
func (rsp *RetryableProxy) Type() string {
	return rsp.storage.Type()
}

//IsCachingDisabled returns true if caching is disabled in destination configuration
func (rsp *RetryableProxy) IsCachingDisabled() bool {
	return rsp.config.destination.CachingConfiguration != nil &&
		rsp.config.destination.CachingConfiguration.Disabled
}

func (rsp *RetryableProxy) GetPostHandleDestinations() []string {
	return rsp.config.PostHandleDestinations
}

//Close stops underlying goroutine and close the storage
func (rsp *RetryableProxy) Close() error {
	rsp.closed.Store(true)
	if rsp.storage != nil {
		return rsp.storage.Close()
	}
	return nil
}
