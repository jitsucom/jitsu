package destinations

import (
	"context"
	"errors"
	"fmt"
	"github.com/hashicorp/go-multierror"
	"github.com/ksensehq/eventnative/appconfig"
	"github.com/ksensehq/eventnative/events"
	"github.com/ksensehq/eventnative/logging"
	"github.com/ksensehq/eventnative/resources"
	"github.com/ksensehq/eventnative/storages"
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
	storageFactoryMethod func(ctx context.Context, name, logEventPath string, destination storages.DestinationConfig, monitorKeeper storages.MonitorKeeper) (events.StorageProxy, *events.PersistentQueue, error)
	ctx                  context.Context
	logEventPath         string
	monitorKeeper        storages.MonitorKeeper

	unitsByName           map[string]*Unit
	loggersUsageByTokenId map[string]*LoggerUsage

	sync.RWMutex
	consumersByTokenId TokenizedConsumers
	storagesByTokenId  TokenizedStorages

	forceReloadFunc func()
}

//only for tests
func NewTestService(consumersByTokenId TokenizedConsumers, storagesByTokenId TokenizedStorages) *Service {
	return &Service{
		consumersByTokenId: consumersByTokenId,
		storagesByTokenId:  storagesByTokenId,
	}
}

//NewService return loaded Service instance and call resources.Watcher() if destinations source is http url or file path
func NewService(ctx context.Context, destinations *viper.Viper, destinationsSource, logEventPath string, monitorKeeper storages.MonitorKeeper,
	storageFactoryMethod func(ctx context.Context, name, logEventPath string, destination storages.DestinationConfig, monitorKeeper storages.MonitorKeeper) (events.StorageProxy, *events.PersistentQueue, error)) (*Service, error) {
	service := &Service{
		storageFactoryMethod: storageFactoryMethod,
		ctx:                  ctx,
		logEventPath:         logEventPath,
		monitorKeeper:        monitorKeeper,

		unitsByName:           map[string]*Unit{},
		loggersUsageByTokenId: map[string]*LoggerUsage{},

		consumersByTokenId: map[string]map[string]events.Consumer{},
		storagesByTokenId:  map[string]map[string]events.StorageProxy{},
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
			service.forceReloadFunc = resources.Watch(serviceName, destinationsSource, resources.LoadFromHttp, service.updateDestinations, time.Duration(reloadSec)*time.Second)
		} else if strings.Contains(destinationsSource, "file://") {
			service.forceReloadFunc = resources.Watch(serviceName, strings.Replace(destinationsSource, "file://", "", 1), resources.LoadFromFile, service.updateDestinations, time.Duration(reloadSec)*time.Second)
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

func (ds *Service) GetStorages(tokenId string) (storages []events.StorageProxy) {
	ds.RLock()
	defer ds.RUnlock()
	for _, s := range ds.storagesByTokenId[tokenId] {
		storages = append(storages, s)
	}
	return
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
	for name, d := range dc {
		//common case
		destination := d

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

		var tokenIds []string
		//map token -> id
		if len(destination.OnlyTokens) > 0 {
			tokenIds = appconfig.Instance.AuthorizationService.GetAllIdsByToken(destination.OnlyTokens)
		} else {
			logging.Warnf("[%s] only_tokens wasn't provided. All tokens will be stored.", name)
			tokenIds = appconfig.Instance.AuthorizationService.GetAllTokenIds()
		}

		if len(tokenIds) == 0 {
			logging.Warnf("[%s] destination's authorization isn't ready. Will be created in next reloading cycle.", name)
			//authorization tokens weren't loaded => create this destination in next reloading cycle
			//we need force reload because destinations won't necessarily be changed
			if s.forceReloadFunc != nil {
				s.forceReloadFunc()
			}
			continue
		}

		//create new
		newStorageProxy, eventQueue, err := s.storageFactoryMethod(s.ctx, name, s.logEventPath, destination, s.monitorKeeper)
		if err != nil {
			logging.Errorf("[%s] Error initializing destination of type %s: %v", name, destination.Type, err)
			continue
		}

		s.unitsByName[name] = &Unit{
			eventQueue: eventQueue,
			storage:    newStorageProxy,
			tokenIds:   tokenIds,
			hash:       hash,
		}

		//create:
		//  1 logger per token id
		//  1 queue per destination id
		//append:
		//  storage per token id
		//  consumers per client_secret and server_secret
		for _, tokenId := range tokenIds {
			if destination.Mode == storages.StreamMode {
				newConsumers.Add(tokenId, name, eventQueue)
			} else {
				//get or create new logger
				loggerUsage, ok := s.loggersUsageByTokenId[tokenId]
				if !ok {
					eventLogWriter, err := logging.NewWriter(logging.Config{
						LoggerName:  "event-" + tokenId,
						ServerName:  appconfig.Instance.ServerName,
						FileDir:     s.logEventPath,
						RotationMin: viper.GetInt64("log.rotation_min")})
					if err != nil {
						logging.Errorf("[%s] Error creating tokenized logger: %v", name, err)
					} else {
						logger := events.NewAsyncLogger(eventLogWriter, viper.GetBool("log.show_in_server"))
						loggerUsage = &LoggerUsage{logger: logger, usage: 0}
						s.loggersUsageByTokenId[tokenId] = loggerUsage
					}
				}

				if loggerUsage != nil {
					loggerUsage.usage += 1
					//2 destinations with only 1 logger can be under 1 tokenId
					newConsumers.Add(tokenId, tokenId, loggerUsage.logger)
				}
			}

			newStorages.Add(tokenId, name, newStorageProxy)
		}
	}

	s.Lock()
	s.consumersByTokenId.AddAll(newConsumers)
	s.storagesByTokenId.AddAll(newStorages)
	s.Unlock()

	StatusInstance.Reloading = false
}

//remove destination from all collections and close it
func (s *Service) remove(name string, unit *Unit) {
	//remove from all collections: queue or logger(if needed) + storage
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
		oldStorages := s.storagesByTokenId[tokenId]
		delete(oldStorages, name)
		if len(oldStorages) == 0 {
			delete(s.storagesByTokenId, tokenId)
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
