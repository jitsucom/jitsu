package destinations

import (
	"errors"
	"fmt"
	"github.com/hashicorp/go-multierror"
	"github.com/jitsucom/jitsu/server/appconfig"
	"github.com/jitsucom/jitsu/server/events"
	"github.com/jitsucom/jitsu/server/logging"
	"github.com/jitsucom/jitsu/server/resources"
	"github.com/jitsucom/jitsu/server/storages"
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

//Service is a reloadable service of events destinations per token
type Service struct {
	storageFactory storages.Factory
	loggerFactory  *logging.Factory

	//map for holding all destinations for closing
	unitsByID map[string]*Unit
	//map for holding all loggers for closing
	loggersUsageByTokenID map[string]*LoggerUsage

	sync.RWMutex

	consumersByTokenID TokenizedConsumers
	//batchStoragesByTokenID - only batch mode destinations by TokenID
	batchStoragesByTokenID  TokenizedStorages
	destinationsIDByTokenID TokenizedIDs

	//events queues by destination ID
	queueConsumerByDestinationID map[string]events.Consumer

	strictAuth bool
}

//NewTestService returns test instance. It is used only for tests
func NewTestService(unitsByID map[string]*Unit, consumersByTokenID TokenizedConsumers, storagesByTokenID TokenizedStorages,
	destinationsIDByTokenID TokenizedIDs, queueConsumerByDestinationID map[string]events.Consumer) *Service {
	return &Service{
		unitsByID:                    unitsByID,
		consumersByTokenID:           consumersByTokenID,
		batchStoragesByTokenID:       storagesByTokenID,
		destinationsIDByTokenID:      destinationsIDByTokenID,
		queueConsumerByDestinationID: queueConsumerByDestinationID,
	}
}

//NewService returns loaded Service instance and call resources.Watcher() if destinations source is http url or file path
func NewService(destinations *viper.Viper, destinationsSource string, storageFactory storages.Factory, loggerFactory *logging.Factory, strictAuth bool) (*Service, error) {
	service := &Service{
		storageFactory: storageFactory,
		loggerFactory:  loggerFactory,

		unitsByID:             map[string]*Unit{},
		loggersUsageByTokenID: map[string]*LoggerUsage{},

		consumersByTokenID:      map[string]map[string]events.Consumer{},
		batchStoragesByTokenID:  map[string]map[string]storages.StorageProxy{},
		destinationsIDByTokenID: map[string]map[string]bool{},

		queueConsumerByDestinationID: map[string]events.Consumer{},

		strictAuth: strictAuth,
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

		if len(service.unitsByID) == 0 {
			logging.Info("Destinations are empty")
		}

	} else if destinationsSource != "" {
		if strings.HasPrefix(destinationsSource, "http://") || strings.HasPrefix(destinationsSource, "https://") {
			appconfig.Instance.AuthorizationService.DestinationsForceReload = resources.Watch(serviceName, destinationsSource, resources.LoadFromHTTP, service.updateDestinations, time.Duration(reloadSec)*time.Second)
		} else if strings.Contains(destinationsSource, "file://") || strings.HasPrefix(destinationsSource, "/") {
			appconfig.Instance.AuthorizationService.DestinationsForceReload = resources.Watch(serviceName, strings.Replace(destinationsSource, "file://", "", 1), resources.LoadFromFile, service.updateDestinations, time.Duration(reloadSec)*time.Second)
		} else if strings.HasPrefix(destinationsSource, "{") && strings.HasSuffix(destinationsSource, "}") {
			service.updateDestinations([]byte(destinationsSource))
		} else {
			return nil, errors.New("Unknown destination source: " + destinationsSource)
		}
	} else {
		logging.Warnf("❌ Destinations aren't configured")
	}

	return service, nil
}

func (s *Service) GetConsumers(tokenID string) (consumers []events.Consumer) {
	s.RLock()
	defer s.RUnlock()
	for _, c := range s.consumersByTokenID[tokenID] {
		consumers = append(consumers, c)
	}
	return
}

func (s *Service) GetDestinationByID(id string) (storages.StorageProxy, bool) {
	s.RLock()
	defer s.RUnlock()

	unit, ok := s.unitsByID[id]
	if !ok {
		return nil, false
	}

	return unit.storage, true
}

func (s *Service) GetDestinations(tokenID string) (storages []storages.StorageProxy) {
	s.RLock()
	defer s.RUnlock()

	for destinationID, _ := range s.destinationsIDByTokenID[tokenID] {
		unit, ok := s.unitsByID[destinationID]
		if ok {
			storages = append(storages, unit.storage)
		}
	}

	return storages
}

func (s *Service) GetBatchStorages(tokenID string) (storages []storages.StorageProxy) {
	s.RLock()
	defer s.RUnlock()
	for _, s := range s.batchStoragesByTokenID[tokenID] {
		storages = append(storages, s)
	}
	return
}

func (s *Service) GetDestinationIDs(tokenID string) map[string]bool {
	ids := map[string]bool{}
	s.RLock()
	defer s.RUnlock()
	for id := range s.destinationsIDByTokenID[tokenID] {
		ids[id] = true
	}
	return ids
}

func (s *Service) GetEventsConsumerByDestinationID(destinationID string) (events.Consumer, bool) {
	s.RLock()
	defer s.RUnlock()

	eventsConsumer, ok := s.queueConsumerByDestinationID[destinationID]
	if !ok {
		return nil, false
	}

	return eventsConsumer, true

}

func (s *Service) updateDestinations(payload []byte) {
	dc, err := parseFromBytes(payload)
	if err != nil {
		logging.Error(marshallingErrorMsg, err)
		return
	}

	s.init(dc)

	if len(s.unitsByID) == 0 {
		logging.Info("Destinations are empty")
	}
}

//1. close and remove all destinations which don't exist in new config
//2. recreate/create changed/new destinations
func (s *Service) init(dc map[string]storages.DestinationConfig) {
	StatusInstance.Reloading = true

	//close and remove non-existent (in new config)
	toDelete := map[string]*Unit{}
	for unitID, unit := range s.unitsByID {
		_, ok := dc[unitID]
		if !ok {
			toDelete[unitID] = unit
		}
	}
	if len(toDelete) > 0 {
		s.Lock()
		for unitID, unit := range toDelete {
			s.removeAndClose(unitID, unit)
		}
		s.Unlock()
	}

	// create or recreate
	newConsumers := TokenizedConsumers{}
	newStorages := TokenizedStorages{}
	newIDs := TokenizedIDs{}
	queueConsumerByDestinationID := map[string]events.Consumer{}

	for destinationID, d := range dc {
		//common case
		destinationConfig := d
		id := destinationID

		//map token -> id
		if len(destinationConfig.OnlyTokens) > 0 {
			destinationConfig.OnlyTokens = appconfig.Instance.AuthorizationService.GetAllIDsByToken(destinationConfig.OnlyTokens)
		} else if !s.strictAuth {
			logging.Warnf("[%s] only_tokens aren't provided. All tokens will be stored.", id)
			destinationConfig.OnlyTokens = appconfig.Instance.AuthorizationService.GetAllTokenIDs()
		}

		hash, err := resources.GetHash(destinationConfig)
		if err != nil {
			logging.SystemErrorf("Error getting hash from [%s] destination: %v. Destination will be skipped!", id, err)
			continue
		}

		unit, ok := s.unitsByID[id]
		if ok {
			if unit.hash == hash {
				//destination wasn't changed
				continue
			}
			//remove old (for recreation)
			s.Lock()
			s.removeAndClose(id, unit)
			s.Unlock()
		}

		if !s.strictAuth && len(destinationConfig.OnlyTokens) == 0 {
			logging.Warnf("[%s] destination's authorization isn't ready. Will be created in next reloading cycle.", id)
			//authorization tokens weren't loaded => create this destination when authorization service will be reloaded
			//and call force reload on this service
			continue
		}

		//create new
		newStorageProxy, eventQueue, err := s.storageFactory.Create(id, destinationConfig)
		if err != nil {
			logging.Errorf("[%s] Error initializing destination of type %s: %v", id, destinationConfig.Type, err)
			continue
		}
		appconfig.Instance.ScheduleEventsConsumerClosing(eventQueue)

		queueConsumerByDestinationID[id] = eventQueue
		s.unitsByID[id] = &Unit{
			eventQueue: eventQueue,
			storage:    newStorageProxy,
			tokenIDs:   destinationConfig.OnlyTokens,
			hash:       hash,
		}

		//create:
		//  1 logger per token id
		//  1 queue per destination id
		//append:
		//  storage per token id
		//  consumers per client_secret and server_secret
		// If destination is staged, consumer must not be added as staged
		// destinations may be used only by dry-run functionality
		for _, tokenID := range destinationConfig.OnlyTokens {
			if destinationConfig.Staged {
				logging.Warnf("[%s] Skipping consumer creation for staged destination", id)
				continue
			}
			newIDs.Add(tokenID, id)
			if destinationConfig.Mode == storages.StreamMode {
				newConsumers.Add(tokenID, id, eventQueue)
			} else {
				//get or create new logger
				loggerUsage, ok := s.loggersUsageByTokenID[tokenID]
				if !ok {
					incomeLogger := s.loggerFactory.CreateIncomingLogger(tokenID)
					appconfig.Instance.ScheduleEventsConsumerClosing(incomeLogger)
					loggerUsage = &LoggerUsage{logger: incomeLogger, usage: 0}
					s.loggersUsageByTokenID[tokenID] = loggerUsage
				}

				if loggerUsage != nil {
					loggerUsage.usage += 1
					//2 destinations with only 1 logger can be under 1 tokenID
					newConsumers.Add(tokenID, tokenID, loggerUsage.logger)
				}

				//add storage only if batch mode
				newStorages.Add(tokenID, id, newStorageProxy)
			}
		}
	}

	s.Lock()
	s.consumersByTokenID.AddAll(newConsumers)
	s.batchStoragesByTokenID.AddAll(newStorages)
	s.destinationsIDByTokenID.AddAll(newIDs)

	for destinationID, eventsQueueConsumer := range queueConsumerByDestinationID {
		s.queueConsumerByDestinationID[destinationID] = eventsQueueConsumer
	}
	s.Unlock()

	StatusInstance.Reloading = false
}

//removeAndClose removes and closes destination from all collections and close it
//method must be called with locks
func (s *Service) removeAndClose(destinationID string, unit *Unit) {
	//remove from other collections: queue or logger(if needed) + storage
	for _, tokenID := range unit.tokenIDs {
		oldConsumers := s.consumersByTokenID[tokenID]
		if unit.eventQueue != nil {
			delete(oldConsumers, destinationID)
		} else {
			//logger
			loggerUsage := s.loggersUsageByTokenID[tokenID]
			loggerUsage.usage -= 1
			if loggerUsage.usage == 0 {
				delete(oldConsumers, tokenID)
				delete(s.loggersUsageByTokenID, tokenID)
				loggerUsage.logger.Close()
			}
		}

		if len(oldConsumers) == 0 {
			delete(s.consumersByTokenID, tokenID)
		}

		//storage
		oldStorages, ok := s.batchStoragesByTokenID[tokenID]
		if ok {
			delete(oldStorages, destinationID)
			if len(oldStorages) == 0 {
				delete(s.batchStoragesByTokenID, tokenID)
			}
		}

		//id
		ids, ok := s.destinationsIDByTokenID[tokenID]
		if ok {
			delete(ids, destinationID)
			if len(ids) == 0 {
				delete(s.destinationsIDByTokenID, tokenID)
			}
		}

		//queue consumer
		delete(s.queueConsumerByDestinationID, destinationID)
	}

	if err := unit.Close(); err != nil {
		logging.Errorf("[%s] Error closing unit: %v", destinationID, err)
	}

	delete(s.unitsByID, destinationID)
	logging.Infof("[%s] destination has been removed!", destinationID)
}

//Close closes destination storages
func (s *Service) Close() (multiErr error) {
	for id, unit := range s.unitsByID {
		if err := unit.CloseStorage(); err != nil {
			multiErr = multierror.Append(multiErr, fmt.Errorf("[%s] Error closing destination unit storage: %v", id, err))
		}
	}

	return
}
