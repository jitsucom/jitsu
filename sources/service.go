package sources

import (
	"context"
	"errors"
	"fmt"
	"github.com/hashicorp/go-multierror"
	"github.com/ksensehq/eventnative/destinations"
	"github.com/ksensehq/eventnative/drivers"
	"github.com/ksensehq/eventnative/events"
	"github.com/ksensehq/eventnative/logging"
	"github.com/ksensehq/eventnative/meta"
	"github.com/ksensehq/eventnative/metrics"
	"github.com/ksensehq/eventnative/safego"
	"github.com/ksensehq/eventnative/storages"
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

	//for locking in single en node setup
	syncCollectionLocks sync.Map

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
	for name, sourceConfig := range sc {

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
		return errors.New("Source doesn't exist")
	}

	var destinationStorages []events.Storage
	for _, destinationId := range sourceUnit.DestinationIds {
		storageProxy, ok := s.destinationsService.GetStorageById(destinationId)
		if ok {
			storage, ok := storageProxy.Get()
			if ok {
				destinationStorages = append(destinationStorages, storage)
			} else {
				logging.Errorf("System error getting destination [%s] in source [%s]: destination isn't initialized", destinationId, sourceId)
			}
		} else {
			logging.Errorf("System error getting destination [%s] in source [%s]: doesn't exist", destinationId, sourceId)
		}

	}

	if len(destinationStorages) == 0 {
		return errors.New("Empty destinations")
	}

	for collection, driver := range sourceUnit.DriverPerCollection {
		identifier := sourceId + "_" + collection
		_, loaded := s.syncCollectionLocks.LoadOrStore(identifier, true)
		if loaded {
			multiErr = multierror.Append(multiErr, fmt.Errorf("Error local locking [%s] source [%s] collection: already locked", sourceId, collection))
			continue
		}

		collectionLock, err := s.monitorKeeper.Lock(sourceId, collection)
		if err != nil {
			multiErr = multierror.Append(multiErr, fmt.Errorf("Error locking [%s] source [%s] collection: %v", sourceId, collection, err))
			continue
		}

		err = s.pool.Invoke(SyncTask{
			sourceId:     sourceId,
			collection:   collection,
			identifier:   identifier,
			driver:       driver,
			metaStorage:  s.metaStorage,
			destinations: destinationStorages,
			lock:         collectionLock,
		})
		if err != nil {
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
		return nil, errors.New("Source doesn't exist")
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
		return nil, errors.New("Source doesn't exist")
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
	synctTask, ok := i.(SyncTask)
	if !ok {
		logging.Errorf("System error sync task has unknown type: %T", i)
		return
	}

	defer s.syncCollectionLocks.Delete(synctTask.identifier)
	synctTask.Sync()
}

func (s *Service) Close() error {
	s.closed = true
	s.pool.Release()

	return nil
}
