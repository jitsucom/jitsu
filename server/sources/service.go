package sources

import (
	"context"
	"errors"
	"fmt"
	"github.com/hashicorp/go-multierror"
	"github.com/jitsucom/jitsu/server/destinations"
	"github.com/jitsucom/jitsu/server/drivers"
	"github.com/jitsucom/jitsu/server/logging"
	"github.com/jitsucom/jitsu/server/meta"
	"github.com/jitsucom/jitsu/server/resources"
	"github.com/jitsucom/jitsu/server/scheduling"
	"github.com/spf13/viper"
	"strings"
	"sync"
	"time"
)

const serviceName = "sources"
const marshallingErrorMsg = `
Error initializing source: wrong config format: each source must contains one key and config as a value(see https://docs.eventnative.dev/configuration) e.g. 
sources:  
  custom_name:
    type: google_play
    ...
`

//Service keep up-to-date sources
type Service struct {
	sync.RWMutex

	ctx     context.Context
	sources map[string]*Unit

	destinationsService *destinations.Service
	cronScheduler       *scheduling.CronScheduler

	configured bool
}

//NewTestService is used only for tests
func NewTestService() *Service {
	return &Service{}
}

//NewService returns initialized Service instance
//or error if occurred
func NewService(ctx context.Context, sources *viper.Viper, sourcesURL string, destinationsService *destinations.Service, metaStorage meta.Storage,
	cronScheduler *scheduling.CronScheduler) (*Service, error) {
	service := &Service{
		ctx:     ctx,
		sources: map[string]*Unit{},

		destinationsService: destinationsService,
		cronScheduler:       cronScheduler,
	}

	if sources == nil && sourcesURL == "" {
		logging.Warnf("Sources aren't configured")
		return service, nil
	}

	reloadSec := viper.GetInt("server.sources_reload_sec")
	if reloadSec == 0 {
		return nil, errors.New("server.sources_reload_sec can't be empty")
	}

	if metaStorage.Type() == meta.DummyType {
		return nil, errors.New("Meta storage is required")
	}

	service.configured = true

	if sources != nil {
		sc := map[string]drivers.SourceConfig{}
		if err := sources.Unmarshal(&sc); err != nil {
			logging.Error(marshallingErrorMsg, err)
			return service, nil
		}

		service.init(sc)

		if len(service.sources) == 0 {
			logging.Errorf("Sources are empty")
		}
	} else {
		if strings.HasPrefix(sourcesURL, "http://") || strings.HasPrefix(sourcesURL, "https://") {
			resources.Watch(serviceName, sourcesURL, resources.LoadFromHTTP, service.updateSources, time.Duration(reloadSec)*time.Second)
		} else if strings.Contains(sourcesURL, "file://") || strings.HasPrefix(sourcesURL, "/") {
			resources.Watch(serviceName, strings.Replace(sourcesURL, "file://", "", 1), resources.LoadFromFile, service.updateSources, time.Duration(reloadSec)*time.Second)
		} else if strings.HasPrefix(sourcesURL, "{") && strings.HasSuffix(sourcesURL, "}") {
			service.updateSources([]byte(sourcesURL))
		} else {
			return nil, errors.New("Unknown sources configuration: " + sourcesURL)
		}
	}

	return service, nil
}

func (s *Service) updateSources(payload []byte) {
	dc, err := parseFromBytes(payload)
	if err != nil {
		logging.Error(marshallingErrorMsg, err)
		return
	}

	s.init(dc)

	if len(s.sources) == 0 {
		logging.Error("Sources are empty")
	}
}

func (s *Service) init(sc map[string]drivers.SourceConfig) {
	StatusInstance.Reloading = true

	//close and remove non-existent (in new config)
	toDelete := map[string]*Unit{}
	for name, unit := range s.sources {
		_, ok := sc[name]
		if !ok {
			toDelete[name] = unit
		}
	}
	if len(toDelete) > 0 {
		s.Lock()
		for name, unit := range toDelete {
			s.remove(name, unit)
		}
		s.Unlock()
	}

	for sourceName, config := range sc {
		//common case
		sourceConfig := config
		name := sourceName

		hash, err := resources.GetHash(config)
		if err != nil {
			logging.SystemErrorf("Error getting hash from [%s] source: %v. Source will be skipped!", name, err)
			continue
		}

		unit, ok := s.sources[name]
		if ok {
			if unit.hash == hash {
				//source wasn't changed
				continue
			}
			//remove old (for recreation)
			s.Lock()
			s.remove(name, unit)
			s.Unlock()
		}

		driverPerCollection, err := drivers.Create(s.ctx, name, &sourceConfig, s.cronScheduler)
		if err != nil {
			logging.Errorf("[%s] Error initializing source of type %s: %v", name, sourceConfig.Type, err)
			continue
		}

		s.Lock()
		s.sources[name] = &Unit{
			SourceType:          sourceConfig.Type,
			DriverPerCollection: driverPerCollection,
			DestinationIDs:      sourceConfig.Destinations,
			hash:                hash,
		}
		s.Unlock()

		logging.Infof("[%s] source has been initialized!", name)
	}
}

func (s *Service) IsConfigured() bool {
	return s.configured
}

func (s *Service) GetSource(sourceID string) (*Unit, error) {
	s.RLock()
	defer s.RUnlock()

	unit, ok := s.sources[sourceID]
	if !ok {
		return nil, fmt.Errorf("Source [%s] doesn't exist", sourceID)
	}

	return unit, nil
}

func (s *Service) GetCollections(sourceID string) ([]string, error) {
	s.RLock()
	defer s.RUnlock()

	unit, ok := s.sources[sourceID]
	if !ok {
		return nil, fmt.Errorf("Source [%s] doesn't exist", sourceID)
	}

	collections := []string{}
	for collection := range unit.DriverPerCollection {
		collections = append(collections, collection)
	}

	return collections, nil
}

//remove closes and removes source instance from Service
//method must be called with locks
func (s *Service) remove(name string, unit *Unit) {
	for collection := range unit.DriverPerCollection {
		err := s.cronScheduler.Remove(name, collection)
		if err != nil {
			logging.Errorf("[%s] Error stopping scheduling collection [%s] sync: %v", name, collection, err)
		}
	}

	if err := unit.Close(); err != nil {
		logging.Errorf("[%s] Error closing source unit: %v", name, err)
	}

	delete(s.sources, name)
	logging.Infof("[%s] has been removed!", name)
}

func (s *Service) Close() (multiErr error) {
	s.RLock()
	for _, unit := range s.sources {
		err := unit.Close()
		if err != nil {
			multiErr = multierror.Append(multiErr, err)
		}
	}
	s.RUnlock()

	return
}
