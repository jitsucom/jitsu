package geo

import (
	"github.com/jitsucom/jitsu/server/logging"
	"github.com/jitsucom/jitsu/server/safego"
	"sync"
	"time"
)

//UpdatableProxy creates Resolver and re-create it every 24 hours with retry (if create fails e.g. because of connection issue)
type UpdatableProxy struct {
	factoryMethod func(path string) (Resolver, error)

	maxmindLink string

	mutex    *sync.RWMutex
	resolver Resolver

	closed chan struct{}
}

//newResolverProxy creates Resolver immediately and starts goroutine for re-create Resolver
func newResolverProxy(maxmindLink string, factoryMethod func(path string) (Resolver, error)) (Resolver, error) {
	underlyingResolver, err := factoryMethod(maxmindLink)
	if err != nil {
		return nil, err
	}

	up := &UpdatableProxy{
		factoryMethod: factoryMethod,
		maxmindLink:   maxmindLink,
		mutex:         &sync.RWMutex{},
		resolver:      underlyingResolver,
		closed:        make(chan struct{}),
	}

	up.start()
	return up, nil
}

func (up *UpdatableProxy) start() {
	safego.RunWithRestart(func() {
		ticker := time.NewTicker(24 * time.Hour)
		for {
			select {
			case <-up.closed:
				return
			case <-ticker.C:
				logging.Info("running geo resolver databases update..")
				resolver, err := up.factoryMethod(up.maxmindLink)
				if err != nil {
					logging.SystemErrorf("Error reloading geo resolver [%s]: %v", up.maxmindLink, err)
					continue
				}

				up.mutex.Lock()
				up.resolver = resolver
				up.mutex.Unlock()
			}
		}
	}).WithRestartTimeout(1 * time.Minute)
}

func (up *UpdatableProxy) Resolve(ip string) (*Data, error) {
	up.mutex.RLock()
	defer up.mutex.RUnlock()

	return up.resolver.Resolve(ip)
}

func (up *UpdatableProxy) Type() string {
	up.mutex.RLock()
	defer up.mutex.RUnlock()

	return up.resolver.Type()
}

func (up *UpdatableProxy) Close() error {
	up.mutex.RLock()
	defer up.mutex.RUnlock()

	select {
	case <-up.closed:
		return nil
	default:
		close(up.closed)
		return up.resolver.Close()
	}
}
