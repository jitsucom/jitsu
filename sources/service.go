package sources

import (
	"context"
	"errors"
	"fmt"
	"github.com/hashicorp/go-multierror"
	"github.com/jitsucom/eventnative/destinations"
	"github.com/jitsucom/eventnative/drivers"
	"github.com/jitsucom/eventnative/logging"
	"github.com/jitsucom/eventnative/meta"
	"github.com/jitsucom/eventnative/scheduling"
	"github.com/spf13/viper"
	"sync"
)

const marshallingErrorMsg = `
Error initializing source: wrong config format: each source must contains one key and config as a value(see https://docs.eventnative.dev/configuration) e.g. 
sources:  
  custom_name:
    type: google_play
    ...
`

type Service struct {
	sync.RWMutex

	ctx     context.Context
	sources map[string]*Unit

	destinationsService *destinations.Service
	cronScheduler       *scheduling.CronScheduler

	configured bool
}

//only for tests
func NewTestService() *Service {
	return &Service{}
}

func NewService(ctx context.Context, sources *viper.Viper, destinationsService *destinations.Service, metaStorage meta.Storage,
	cronScheduler *scheduling.CronScheduler) (*Service, error) {
	service := &Service{
		ctx:     ctx,
		sources: map[string]*Unit{},

		destinationsService: destinationsService,
		cronScheduler:       cronScheduler,
	}

	if sources == nil {
		logging.Warnf("Sources aren't configured")
		return service, nil
	}

	if metaStorage.Type() == meta.DummyType {
		return nil, errors.New("Meta storage is required")
	}

	service.configured = true

	sc := map[string]drivers.SourceConfig{}
	if err := sources.Unmarshal(&sc); err != nil {
		logging.Error(marshallingErrorMsg, err)
		return service, nil
	}

	service.init(sc)

	if len(service.sources) == 0 {
		logging.Errorf("Sources are empty")
	}

	return service, nil
}

func (s *Service) init(sc map[string]drivers.SourceConfig) {
	for sourceName, config := range sc {
		//common case
		sourceConfig := config
		name := sourceName

		driverPerCollection, err := drivers.Create(s.ctx, name, &sourceConfig, s.cronScheduler)
		if err != nil {
			logging.Errorf("[%s] Error initializing source of type %s: %v", name, sourceConfig.Type, err)
			continue
		}

		s.Lock()
		s.sources[name] = &Unit{
			SourceType:          sourceConfig.Type,
			DriverPerCollection: driverPerCollection,
			DestinationIds:      sourceConfig.Destinations,
		}
		s.Unlock()

		//TODO before source removing - cronScheduler.Remove(source, collection)

		logging.Infof("[%s] source has been initialized!", name)
	}
}

func (s *Service) IsConfigured() bool {
	return s.configured
}

func (s *Service) GetSource(sourceId string) (*Unit, error) {
	s.RLock()
	defer s.RUnlock()

	unit, ok := s.sources[sourceId]
	if !ok {
		return nil, fmt.Errorf("Source [%s] doesn't exist", sourceId)
	}

	return unit, nil
}

func (s *Service) GetCollections(sourceId string) ([]string, error) {
	s.RLock()
	defer s.RUnlock()

	unit, ok := s.sources[sourceId]
	if !ok {
		return nil, fmt.Errorf("Source [%s] doesn't exist", sourceId)
	}

	collections := []string{}
	for collection, _ := range unit.DriverPerCollection {
		collections = append(collections, collection)
	}

	return collections, nil
}

func (s *Service) Close() (multiErr error) {
	s.RLock()
	for _, unit := range s.sources {
		for _, driver := range unit.DriverPerCollection {
			err := driver.Close()
			if err != nil {
				multiErr = multierror.Append(multiErr, err)
			}
		}
	}
	s.RUnlock()

	return
}
