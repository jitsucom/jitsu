package geo

import (
	"context"
	"github.com/hashicorp/go-multierror"
	"github.com/jitsucom/jitsu/server/logging"
	"github.com/jitsucom/jitsu/server/resources"
	"github.com/jitsucom/jitsu/server/safego"
	"github.com/spf13/viper"
	"strings"
	"sync"
	"time"
)

const serviceName = "geo"

type Unit struct {
	resolver Resolver
	hash     uint64
}

//Service keep up-to-date geo data resolvers
type Service struct {
	mutex *sync.RWMutex

	ctx     context.Context
	factory *MaxMindFactory

	geoResolversByID map[string]*Unit

	globalGeoResolver Resolver
}

//NewTestService returns test instance. It is used only for tests
func NewTestService(globalResolver Resolver) *Service {
	if globalResolver == nil {
		globalResolver = &DummyResolver{}
	}
	return &Service{
		mutex:             &sync.RWMutex{},
		ctx:               context.Background(),
		factory:           nil,
		geoResolversByID:  map[string]*Unit{},
		globalGeoResolver: globalResolver,
	}
}

//NewService returns initialized Service instance
func NewService(ctx context.Context, geoURL, globalGeoMaxmindPath, officialDownloadURLTemplate string) *Service {
	service := &Service{
		mutex:             &sync.RWMutex{},
		ctx:               ctx,
		factory:           NewMaxmindFactory(officialDownloadURLTemplate),
		geoResolversByID:  map[string]*Unit{},
		globalGeoResolver: &DummyResolver{},
	}

	if geoURL == "" && globalGeoMaxmindPath == "" {
		logging.Info("❌ Geo resolution won't be available as 'geo.maxmind_path' (or 'geo_resolvers_reload_sec' section) are not set")
		return service
	}

	reloadSec := viper.GetInt("server.geo_resolvers_reload_sec")
	if reloadSec == 0 {
		logging.Error("server.geo_resolvers_reload_sec can't be 0. 1 second will be used as default value")
		reloadSec = 1
	}

	//global geo resolver
	if globalGeoMaxmindPath != "" {
		defaultResolverProxy, err := newResolverProxy(globalGeoMaxmindPath, service.factory.Create)
		if err != nil {
			logging.Warnf("❌ Failed to load global MaxMind DB from %s: %v. Global geo resolution won't be available. You can configure custom one in Configurator UI", globalGeoMaxmindPath, err)
		} else {
			logging.Info("✅ Loaded MaxMind db:", globalGeoMaxmindPath)
			service.globalGeoResolver = defaultResolverProxy
		}
	}

	//per project
	if geoURL != "" {
		if strings.HasPrefix(geoURL, "http://") || strings.HasPrefix(geoURL, "https://") {
			//all dbs load takes a long time
			safego.Run(func() {
				resources.Watch(serviceName, geoURL, resources.LoadFromHTTP, service.updateResolvers, time.Duration(reloadSec)*time.Second)
			})
		} else {
			logging.Infof("❌ Geo resolution isn't available since unknown geo configuration provided: %s. Only http/https link is supported", geoURL)
		}
	}

	return service
}

func (s *Service) updateResolvers(payload []byte) {
	rc, err := parseConfigFromBytes(payload)
	if err != nil {
		logging.Errorf("error unmarshalling project geo resolvers config [%s]: %v", string(payload), err)
		return
	}

	s.init(rc)

	if len(s.geoResolversByID) == 0 {
		logging.Info("❌ Geo resolution isn't configured. You can add MaxMind license key on Jitsu Configurator UI.")
	}
}

func (s *Service) init(rc map[string]*ResolverConfig) {
	//close and remove non-existent (in new config)
	toDelete := map[string]*Unit{}
	s.mutex.RLock()
	for id, unit := range s.geoResolversByID {
		_, ok := rc[id]
		if !ok {
			toDelete[id] = unit
		}
	}
	s.mutex.RUnlock()

	if len(toDelete) > 0 {
		s.mutex.Lock()
		for resolverIDToDel, unit := range toDelete {
			s.remove(resolverIDToDel, unit)
		}
		s.mutex.Unlock()
	}

	for identifier, resolverConfig := range rc {
		//common case
		config := resolverConfig
		id := identifier

		hash, err := resources.GetHash(config)
		if err != nil {
			logging.SystemErrorf("Error getting hash from [%s] geo resolver: %v. Geo resolver will be skipped!", id, err)
			continue
		}

		s.mutex.RLock()
		unit, ok := s.geoResolversByID[id]
		s.mutex.RUnlock()

		if ok {
			if unit.hash == hash {
				//geo resolver wasn't changed
				continue
			}
			//remove old (for recreation)
			s.mutex.Lock()
			s.remove(id, unit)
			s.mutex.Unlock()
		}

		maxmindlink, err := ParseConfigAsLink(config)
		if err != nil {
			logging.Errorf("[%s] Error initializing geo resolver of type %s: %v", id, config.Type, err)
			continue
		}

		resolverProxy, err := newResolverProxy(maxmindlink, s.factory.Create)
		if err != nil {
			logging.Errorf("[%s] Error initializing geo resolver of type %s: %v", id, config.Type, err)
			continue
		}

		s.mutex.Lock()
		s.geoResolversByID[id] = &Unit{
			resolver: resolverProxy,
			hash:     hash,
		}
		s.mutex.Unlock()

		logging.Infof("📍 [%s] geo resolver has been initialized!", id)
	}
}

func (s *Service) GetGeoResolver(id string) Resolver {
	s.mutex.RLock()
	defer s.mutex.RUnlock()

	geoResolver, ok := s.geoResolversByID[id]
	if ok {
		return geoResolver.resolver
	}

	return s.globalGeoResolver
}

func (s *Service) GetGlobalGeoResolver() Resolver {
	return s.globalGeoResolver
}

//TestGeoResolver proxies request to the factory
func (s *Service) TestGeoResolver(url string) ([]*EditionRule, error) {
	return s.factory.Test(url)
}

//GetPaidEditions returns paidEditions
func (s *Service) GetPaidEditions() []Edition {
	return paidEditions
}

//remove closes and removes geo resolver instance from Service
//method must be called with locks
func (s *Service) remove(id string, unit *Unit) {
	if err := unit.resolver.Close(); err != nil {
		logging.Errorf("[%s] Error closing geo resolver: %v", id, err)
	}

	delete(s.geoResolversByID, id)
	logging.Infof("[%s] geo resolver has been removed!", id)
}

func (s *Service) Close() (multiErr error) {
	s.mutex.RLock()
	for _, unit := range s.geoResolversByID {
		err := unit.resolver.Close()
		if err != nil {
			multiErr = multierror.Append(multiErr, err)
		}
	}
	s.mutex.RUnlock()

	return
}
