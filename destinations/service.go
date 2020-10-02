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

	unitsByName         map[string]*Unit
	loggersUsageByToken map[string]*LoggerUsage

	sync.RWMutex
	consumersByToken TokenizedConsumers
	storagesByToken  TokenizedStorages
}

//only for tests
func NewTestService(consumersByToken TokenizedConsumers, storagesByToken TokenizedStorages) *Service {
	return &Service{
		consumersByToken: consumersByToken,
		storagesByToken:  storagesByToken,
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

		unitsByName:         map[string]*Unit{},
		loggersUsageByToken: map[string]*LoggerUsage{},

		consumersByToken: map[string]map[string]events.Consumer{},
		storagesByToken:  map[string]map[string]events.StorageProxy{},
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
			resources.Watch(serviceName, destinationsSource, resources.LoadFromHttp, service.updateDestinations, time.Duration(reloadSec)*time.Second)
		} else if strings.Contains(destinationsSource, "file://") {
			resources.Watch(serviceName, strings.Replace(destinationsSource, "file://", "", 1), resources.LoadFromFile, service.updateDestinations, time.Duration(reloadSec)*time.Second)
		} else if strings.HasPrefix(destinationsSource, "{") && strings.HasSuffix(destinationsSource, "}") {
			service.updateDestinations([]byte(destinationsSource))
		} else {
			return nil, errors.New("Unknown destination source: " + destinationsSource)
		}
	}

	return service, nil
}

func (ds *Service) GetConsumers(token string) (consumers []events.Consumer) {
	ds.RLock()
	defer ds.RUnlock()
	for _, c := range ds.consumersByToken[token] {
		consumers = append(consumers, c)
	}
	return
}

func (ds *Service) GetStorages(token string) (storages []events.StorageProxy) {
	ds.RLock()
	defer ds.RUnlock()
	for _, s := range ds.storagesByToken[token] {
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
			//remove old
			s.Lock()
			s.remove(name, unit)
			s.Unlock()
		}

		//create new
		newStorageProxy, eventQueue, err := s.storageFactoryMethod(s.ctx, name, s.logEventPath, destination, s.monitorKeeper)
		if err != nil {
			logging.Errorf("[%s] Error initializing destination of type %s: %v", name, destination.Type, err)
			continue
		}

		tokens := destination.OnlyTokens
		if len(tokens) == 0 {
			logging.Warnf("[%s] only_tokens wasn't provided. All tokens will be stored.", name)
			for token := range appconfig.Instance.AuthorizationService.GetAllTokens() {
				tokens = append(tokens, token)
			}
		}

		s.unitsByName[name] = &Unit{
			eventQueue: eventQueue,
			storage:    newStorageProxy,
			tokens:     tokens,
			hash:       hash,
		}

		//append:
		//storage per token
		//consumer(event queue or logger) per token
		for _, token := range tokens {
			if destination.Mode == storages.StreamMode {
				//2 destinations with 2 queues can be under 1 token
				newConsumers.Add(token, name, eventQueue)
			} else {
				//get or create new logger
				loggerUsage, ok := s.loggersUsageByToken[token]
				if !ok {
					eventLogWriter, err := logging.NewWriter(logging.Config{
						LoggerName:  "event-" + token,
						ServerName:  appconfig.Instance.ServerName,
						FileDir:     s.logEventPath,
						RotationMin: viper.GetInt64("log.rotation_min")})
					if err != nil {
						logging.Errorf("[%s] Error creating tokenized logger: %v", name, err)
					} else {
						logger := events.NewAsyncLogger(eventLogWriter, viper.GetBool("log.show_in_server"))
						loggerUsage = &LoggerUsage{logger: logger, usage: 0}
						s.loggersUsageByToken[token] = loggerUsage
					}
				}

				if loggerUsage != nil {
					loggerUsage.usage += 1
					//2 destinations with only 1 logger can be under 1 token
					newConsumers.Add(token, token, loggerUsage.logger)
				}
			}

			newStorages.Add(token, name, newStorageProxy)
		}
	}

	s.Lock()
	s.consumersByToken.AddAll(newConsumers)
	s.storagesByToken.AddAll(newStorages)
	s.Unlock()

	StatusInstance.Reloading = false
}

//remove destination from all collections and close it
func (s *Service) remove(name string, unit *Unit) {
	//remove from all collections: queue or logger(if needed) + storage
	for _, token := range unit.tokens {
		oldConsumers := s.consumersByToken[token]
		if unit.eventQueue != nil {
			delete(oldConsumers, name)
		} else {
			//logger
			loggerUsage := s.loggersUsageByToken[token]
			loggerUsage.usage -= 1
			if loggerUsage.usage == 0 {
				delete(oldConsumers, token)
				delete(s.loggersUsageByToken, token)
				loggerUsage.logger.Close()
			}
		}

		if len(oldConsumers) == 0 {
			delete(s.consumersByToken, token)
		}

		//storage
		oldStorages := s.storagesByToken[token]
		delete(oldStorages, name)
		if len(oldStorages) == 0 {
			delete(s.storagesByToken, token)
		}
	}

	if err := unit.Close(); err != nil {
		logging.Errorf("[%s] Error closing destination unit: %v", name, err)
	}

	delete(s.unitsByName, name)
}

func (s *Service) Close() (multiErr error) {
	for token, loggerUsage := range s.loggersUsageByToken {
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
