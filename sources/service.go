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
	"github.com/jitsucom/eventnative/metrics"
	"github.com/jitsucom/eventnative/safego"
	"github.com/jitsucom/eventnative/storages"
	"github.com/panjf2000/ants/v2"
	"github.com/spf13/viper"
	"io"
	"sync"
	"time"
)

const marshallingErrorMsg = `Error initializing source: wrong config format: each source must contains one key and config as a value(see https://docs.eventnative.dev/configuration) e.g. 
sources:  
  custom_name:
    type: google_play
    ...
`

type Service struct {
	io.Closer
	sync.RWMutex

	ctx     context.Context
	sources map[string]*Unit
	pool    *ants.PoolWithFunc

	destinationsService *destinations.Service
	metaStorage         meta.Storage
	monitorKeeper       storages.MonitorKeeper

	closed bool
}

//only for tests
func NewTestService() *Service {
	return &Service{}
}

func NewService(ctx context.Context, sources *viper.Viper, destinationsService *destinations.Service,
	metaStorage meta.Storage, monitorKeeper storages.MonitorKeeper, poolSize int) (*Service, error) {

	service := &Service{
		ctx:     ctx,
		sources: map[string]*Unit{},

		destinationsService: destinationsService,
		metaStorage:         metaStorage,
		monitorKeeper:       monitorKeeper,
	}

	if sources == nil {
		logging.Warnf("Sources aren't configured")
		return service, nil
	}

	if metaStorage.Type() == meta.DummyType {
		return nil, errors.New("Meta storage is required")
	}

	pool, err := ants.NewPoolWithFunc(poolSize, service.syncCollection)
	if err != nil {
		return nil, fmt.Errorf("Error creating goroutines pool: %v", err)
	}
	service.pool = pool
	defer service.startMonitoring()

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

		driverPerCollection, err := drivers.Create(s.ctx, name, &sourceConfig)
		if err != nil {
			logging.Errorf("[%s] Error initializing source of type %s: %v", name, sourceConfig.Type, err)
			continue
		}

		s.Lock()
		s.sources[name] = &Unit{
			DriverPerCollection: driverPerCollection,
			DestinationIds:      sourceConfig.Destinations,
		}
		s.Unlock()

		logging.Infof("[%s] source has been initialized!", name)

	}
}

//startMonitoring run goroutine for setting pool size metrics every 20 seconds
func (s *Service) startMonitoring() {
	safego.RunWithRestart(func() {
		for {
			if s.closed {
				break
			}

			metrics.RunningSourcesGoroutines(s.pool.Running())
			metrics.FreeSourcesGoroutines(s.pool.Free())

			time.Sleep(20 * time.Second)
		}
	})
}

func (s *Service) Sync(sourceId string) (multiErr error) {
	s.RLock()
	sourceUnit, ok := s.sources[sourceId]
	s.RUnlock()

	if !ok {
		return fmt.Errorf("Source [%s] doesn't exist", sourceId)
	}

	var destinationStorages []storages.Storage
	for _, destinationId := range sourceUnit.DestinationIds {
		storageProxy, ok := s.destinationsService.GetStorageById(destinationId)
		if ok {
			storage, ok := storageProxy.Get()
			if ok {
				destinationStorages = append(destinationStorages, storage)
			} else {
				logging.SystemErrorf("Unable to get destination [%s] in source [%s]: destination isn't initialized", destinationId, sourceId)
			}
		} else {
			logging.SystemErrorf("Unable to get destination [%s] in source [%s]: doesn't exist", destinationId, sourceId)
		}

	}

	if len(destinationStorages) == 0 {
		return errors.New("Empty destinations")
	}

	for collection, driver := range sourceUnit.DriverPerCollection {
		identifier := sourceId + "_" + collection

		collectionLock, err := s.monitorKeeper.Lock(sourceId, collection)
		if err != nil {
			multiErr = multierror.Append(multiErr, fmt.Errorf("Error locking [%s] source [%s] collection: %v", sourceId, collection, err))
			continue
		}

		if driver.Type() == drivers.SingerType {
			singerDriver, ok := driver.(*drivers.Singer)
			if !ok {
				s.monitorKeeper.Unlock(collectionLock)
				multiErr = multierror.Append(multiErr, fmt.Errorf("[%s] Driver in a singer task doesn't implement drivers.Driver", sourceId))
				continue
			}

			ready, notReadyError := singerDriver.Ready()
			if !ready {
				s.monitorKeeper.Unlock(collectionLock)
				multiErr = multierror.Append(multiErr, notReadyError)
				continue
			}

			identifier = sourceId + "_" + singerDriver.GetTap()

			err = s.pool.Invoke(NewSingerTask(sourceId, collection, identifier, singerDriver, s.metaStorage, destinationStorages, collectionLock))
		} else {
			err = s.pool.Invoke(NewSyncTask(sourceId, collection, identifier, driver, s.metaStorage, destinationStorages, collectionLock))
		}

		if err != nil {
			s.monitorKeeper.Unlock(collectionLock)
			multiErr = multierror.Append(multiErr, fmt.Errorf("Error running sync task goroutine [%s] source [%s] collection: %v", sourceId, collection, err))
			continue
		}
	}

	return
}

//GetStatus return status per collection
func (s *Service) GetStatus(sourceId string) (map[string]string, error) {
	s.RLock()
	sourceUnit, ok := s.sources[sourceId]
	s.RUnlock()

	if !ok {
		return nil, fmt.Errorf("Source [%s] doesn't exist", sourceId)
	}

	statuses := map[string]string{}
	for collection, _ := range sourceUnit.DriverPerCollection {
		status, err := s.metaStorage.GetCollectionStatus(sourceId, collection)
		if err != nil {
			return nil, fmt.Errorf("Error getting collection status: %v", err)
		}

		statuses[collection] = status
	}

	return statuses, nil
}

//GetStatus return logs per collection
func (s *Service) GetLogs(sourceId string) (map[string]string, error) {
	s.RLock()
	sourceUnit, ok := s.sources[sourceId]
	s.RUnlock()

	if !ok {
		return nil, fmt.Errorf("Source [%s] doesn't exist", sourceId)
	}

	logsMap := map[string]string{}
	for collection, _ := range sourceUnit.DriverPerCollection {
		log, err := s.metaStorage.GetCollectionLog(sourceId, collection)
		if err != nil {
			return nil, fmt.Errorf("Error getting collection logs: %v", err)
		}

		logsMap[collection] = log
	}

	return logsMap, nil
}

func (s *Service) syncCollection(i interface{}) {
	synctTask, ok := i.(Task)
	if !ok {
		logging.SystemErrorf("Sync task has unknown type: %T", i)
		return
	}

	defer s.monitorKeeper.Unlock(synctTask.GetLock())
	synctTask.Sync()
}

func (s *Service) Close() (multiErr error) {
	s.closed = true

	if s.pool != nil {
		s.pool.Release()
	}

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
