package destinations

import (
	"context"
	"errors"
	"fmt"
	"github.com/hashicorp/go-multierror"
	"github.com/jitsucom/eventnative/appconfig"
	"github.com/jitsucom/eventnative/caching"
	"github.com/jitsucom/eventnative/events"
	"github.com/jitsucom/eventnative/logging"
	"github.com/jitsucom/eventnative/resources"
	"github.com/jitsucom/eventnative/storages"
	"github.com/spf13/viper"
	"strings"
	"sync"
	"time"
)

const serviceName = "destinations"
const marshallingErrorMsg = `Error initializing destinations: wrong config format: each destination must contains one key and config as a value(see https://docs.eventnative.dev/configuration) e.g. 
destinations:  
  custom_name:
    type: redshift
    ...
`

//LoggerUsage is used for counting when logger isn't used
type LoggerUsage struct {
	logger events.Consumer
	usage  int
}

//Service is reloadable service of events destinations per token
type Service struct {
	storageFactoryMethod func(ctx context.Context, name, logEventPath, logFallbackPath string, logRotationMin int64, destination storages.DestinationConfig, monitorKeeper storages.MonitorKeeper, eventsCache *caching.EventsCache) (events.StorageProxy, *events.PersistentQueue, error)
	ctx                  context.Context
	logEventPath         string
	logFallbackPath      string
	logRotationMin       int64
	monitorKeeper        storages.MonitorKeeper
	eventsCache          *caching.EventsCache

	//map for holding all destinations for closing
	unitsByName map[string]*Unit
	//map for holding all loggers for closing
	loggersUsageByTokenId map[string]*LoggerUsage

	sync.RWMutex
	consumersByTokenId      TokenizedConsumers
	storagesByTokenId       TokenizedStorages
	destinationsIdByTokenId TokenizedIds
}

//only for tests
func NewTestService(consumersByTokenId TokenizedConsumers, storagesByTokenId TokenizedStorages, destinationsIdByTokenId TokenizedIds) *Service {
	return &Service{
		consumersByTokenId:      consumersByTokenId,
		storagesByTokenId:       storagesByTokenId,
		destinationsIdByTokenId: destinationsIdByTokenId,
	}
}

//NewService return loaded Service instance and call resources.Watcher() if destinations source is http url or file path
func NewService(ctx context.Context, destinations *viper.Viper, destinationsSource, logEventPath, logFallbackPath string, logRotationMin int64, monitorKeeper storages.MonitorKeeper, eventsCache *caching.EventsCache,
	storageFactoryMethod func(ctx context.Context, name, logEventPath, logFallbackPath string, logRotationMin int64, destination storages.DestinationConfig,
		monitorKeeper storages.MonitorKeeper, eventsCache *caching.EventsCache) (events.StorageProxy, *events.PersistentQueue, error)) (*Service, error) {
	service := &Service{
		storageFactoryMethod: storageFactoryMethod,
		ctx:                  ctx,
		logEventPath:         logEventPath,
		logFallbackPath:      logFallbackPath,
		logRotationMin:       logRotationMin,
		monitorKeeper:        monitorKeeper,
		eventsCache:          eventsCache,

		unitsByName:           map[string]*Unit{},
		loggersUsageByTokenId: map[string]*LoggerUsage{},

		consumersByTokenId:      map[string]map[string]events.Consumer{},
		storagesByTokenId:       map[string]map[string]events.StorageProxy{},
		destinationsIdByTokenId: map[string]map[string]bool{},
	}

	reloadSec := viper.GetInt("server.destinations_reload_sec")
	if reloadSec == 0 {
		return nil, errors.New("server.destinations_reload_sec can't be empty")
	}

	if destinations != nil {
		dc := map[string]storages.DestinationConfig{}
		if err := destinations.Unmarshal(&dc); err != nil {
			logging.Error(marshallingErrorMsg, err)
			return service, nil
		}

		service.init(dc)

		if len(service.unitsByName) == 0 {
			logging.Errorf("Destinations are empty")
		}

	} else if destinationsSource != "" {
		if strings.HasPrefix(destinationsSource, "http://") || strings.HasPrefix(destinationsSource, "https://") {
			appconfig.Instance.AuthorizationService.DestinationsForceReload = resources.Watch(serviceName, destinationsSource, resources.LoadFromHttp, service.updateDestinations, time.Duration(reloadSec)*time.Second)
		} else if strings.Contains(destinationsSource, "file://") {
			appconfig.Instance.AuthorizationService.DestinationsForceReload = resources.Watch(serviceName, strings.Replace(destinationsSource, "file://", "", 1), resources.LoadFromFile, service.updateDestinations, time.Duration(reloadSec)*time.Second)
		} else if strings.HasPrefix(destinationsSource, "{") && strings.HasSuffix(destinationsSource, "}") {
			service.updateDestinations([]byte(destinationsSource))
		} else {
			return nil, errors.New("Unknown destination source: " + destinationsSource)
		}
	}

	return service, nil
}

func (ds *Service) GetConsumers(tokenId string) (consumers []events.Consumer) {
	ds.RLock()
	defer ds.RUnlock()
	for _, c := range ds.consumersByTokenId[tokenId] {
		consumers = append(consumers, c)
	}
	return
}

func (ds *Service) GetStorageById(id string) (events.StorageProxy, bool) {
	ds.RLock()
	defer ds.RUnlock()

	unit, ok := ds.unitsByName[id]
	if !ok {
		return nil, false
	}

	return unit.storage, true
}

func (ds *Service) GetStorages(tokenId string) (storages []events.StorageProxy) {
	ds.RLock()
	defer ds.RUnlock()
	for _, s := range ds.storagesByTokenId[tokenId] {
		storages = append(storages, s)
	}
	return
}

func (ds *Service) GetDestinationIds(tokenId string) map[string]bool {
	ids := map[string]bool{}
	ds.RLock()
	defer ds.RUnlock()
	for id := range ds.destinationsIdByTokenId[tokenId] {
		ids[id] = true
	}
	return ids
}

func (s *Service) updateDestinations(payload []byte) {
	dc, err := parseFromBytes(payload)
	if err != nil {
		logging.Error(marshallingErrorMsg, err)
		return
	}

	s.init(dc)

	if len(s.unitsByName) == 0 {
		logging.Errorf("Destinations are empty")
	}
}

//1. close and remove all destinations which don't exist in new config
//2. recreate/create changed/new destinations
func (s *Service) init(dc map[string]storages.DestinationConfig) {
	StatusInstance.Reloading = true

	//close and remove non-existent (in new config)
	toDelete := map[string]*Unit{}
	for name, unit := range s.unitsByName {
		_, ok := dc[name]
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

	// create or recreate
	newConsumers := TokenizedConsumers{}
	newStorages := TokenizedStorages{}
	newIds := TokenizedIds{}
	for name, d := range dc {
		//common case
		destination := d

		//map token -> id
		if len(destination.OnlyTokens) > 0 {
			destination.OnlyTokens = appconfig.Instance.AuthorizationService.GetAllIdsByToken(destination.OnlyTokens)
		} else {
			logging.Warnf("[%s] only_tokens aren't provided. All tokens will be stored.", name)
			destination.OnlyTokens = appconfig.Instance.AuthorizationService.GetAllTokenIds()
		}

		hash := getHash(name, destination)
		unit, ok := s.unitsByName[name]
		if ok {
			if unit.hash == hash {
				//destination wasn't changed
				continue
			}
			//remove old (for recreation)
			s.Lock()
			s.remove(name, unit)
			s.Unlock()
		}

		if len(destination.OnlyTokens) == 0 {
			logging.Warnf("[%s] destination's authorization isn't ready. Will be created in next reloading cycle.", name)
			//authorization tokens weren't loaded => create this destination when authorization service will be reloaded
			//and call force reload on this service
			continue
		}

		//create new
		newStorageProxy, eventQueue, err := s.storageFactoryMethod(s.ctx, name, s.logEventPath, s.logFallbackPath, s.logRotationMin, destination, s.monitorKeeper, s.eventsCache)
		if err != nil {
			logging.Errorf("[%s] Error initializing destination of type %s: %v", name, destination.Type, err)
			continue
		}

		s.unitsByName[name] = &Unit{
			eventQueue: eventQueue,
			storage:    newStorageProxy,
			tokenIds:   destination.OnlyTokens,
			hash:       hash,
		}

		//create:
		//  1 logger per token id
		//  1 queue per destination id
		//append:
		//  storage per token id
		//  consumers per client_secret and server_secret
		for _, tokenId := range destination.OnlyTokens {
			newIds.Add(tokenId, name)
			if destination.Mode == storages.StreamMode {
				newConsumers.Add(tokenId, name, eventQueue)
			} else {
				//get or create new logger
				loggerUsage, ok := s.loggersUsageByTokenId[tokenId]
				if !ok {
					eventLogWriter := logging.NewRollingWriter(logging.Config{
						LoggerName:    "event-" + tokenId,
						ServerName:    appconfig.Instance.ServerName,
						FileDir:       s.logEventPath,
						RotationMin:   s.logRotationMin,
						RotateOnClose: true,
					})
					logger := events.NewAsyncLogger(eventLogWriter, viper.GetBool("log.show_in_server"))
					loggerUsage = &LoggerUsage{logger: logger, usage: 0}
					s.loggersUsageByTokenId[tokenId] = loggerUsage
				}

				if loggerUsage != nil {
					loggerUsage.usage += 1
					//2 destinations with only 1 logger can be under 1 tokenId
					newConsumers.Add(tokenId, tokenId, loggerUsage.logger)
				}

				//add storage only if batch mode
				newStorages.Add(tokenId, name, newStorageProxy)
			}
		}
	}

	s.Lock()
	s.consumersByTokenId.AddAll(newConsumers)
	s.storagesByTokenId.AddAll(newStorages)
	s.destinationsIdByTokenId.AddAll(newIds)
	s.Unlock()

	StatusInstance.Reloading = false
}

//remove destination from all collections and close it
//method must be called with locks
func (s *Service) remove(name string, unit *Unit) {
	//remove from other collections: queue or logger(if needed) + storage
	for _, tokenId := range unit.tokenIds {
		oldConsumers := s.consumersByTokenId[tokenId]
		if unit.eventQueue != nil {
			delete(oldConsumers, name)
		} else {
			//logger
			loggerUsage := s.loggersUsageByTokenId[tokenId]
			loggerUsage.usage -= 1
			if loggerUsage.usage == 0 {
				delete(oldConsumers, tokenId)
				delete(s.loggersUsageByTokenId, tokenId)
				loggerUsage.logger.Close()
			}
		}

		if len(oldConsumers) == 0 {
			delete(s.consumersByTokenId, tokenId)
		}

		//storage
		oldStorages, ok := s.storagesByTokenId[tokenId]
		if ok {
			delete(oldStorages, name)
			if len(oldStorages) == 0 {
				delete(s.storagesByTokenId, tokenId)
			}
		}

		//id
		ids, ok := s.destinationsIdByTokenId[tokenId]
		if ok {
			delete(ids, name)
			if len(ids) == 0 {
				delete(s.destinationsIdByTokenId, tokenId)
			}
		}
	}

	if err := unit.Close(); err != nil {
		logging.Errorf("[%s] Error closing destination unit: %v", name, err)
	}

	delete(s.unitsByName, name)
	logging.Infof("[%s] has been removed!", name)
}

func (s *Service) Close() (multiErr error) {
	for token, loggerUsage := range s.loggersUsageByTokenId {
		if err := loggerUsage.logger.Close(); err != nil {
			multiErr = multierror.Append(multiErr, fmt.Errorf("Error closing logger for token [%s]: %v", token, err))
		}
	}

	for name, unit := range s.unitsByName {
		if err := unit.Close(); err != nil {
			multiErr = multierror.Append(multiErr, fmt.Errorf("[%s] Error closing destination unit: %v", name, err))
		}
	}

	return
}
