package multiplexing

import (
	"errors"
	"github.com/jitsucom/jitsu/server/appconfig"
	"github.com/jitsucom/jitsu/server/counters"
	"github.com/jitsucom/jitsu/server/destinations"
	"github.com/jitsucom/jitsu/server/enrichment"
	"github.com/jitsucom/jitsu/server/events"
	"github.com/jitsucom/jitsu/server/logging"
)

var (
	ErrNoDestinations = errors.New("No destination is configured for token")
)

//Service is a service for accepting, multiplexing events and sending to consumers
type Service struct {
	destinationService *destinations.Service
}

//NewService returns configured Service instance
func NewService(destinationService *destinations.Service) *Service {
	return &Service{
		destinationService: destinationService,
	}
}

//AcceptRequest multiplexes input events, enriches with context and sends to consumers
func (s *Service) AcceptRequest(processor events.Processor, reqContext *events.RequestContext, token string, eventsArray []events.Event) ([]map[string]interface{}, error) {
	tokenID := appconfig.Instance.AuthorizationService.GetTokenID(token)
	destinationStorages := s.destinationService.GetDestinations(tokenID)
	if len(destinationStorages) == 0 {
		counters.SkipPushSourceEvents(tokenID, 1)
		return nil, ErrNoDestinations
	}
	extras := make([]map[string]interface{}, 0)
	for _, payload := range eventsArray {
		//** Context enrichment **
		//Note: we assume that destinations under 1 token can't have different unique ID configuration (JS SDK 2.0 or an old one)
		enrichment.ContextEnrichmentStep(payload, token, reqContext, processor, destinationStorages[0].GetUniqueIDField())

		//Persisted cache
		//extract unique identifier
		eventID := destinationStorages[0].GetUniqueIDField().Extract(payload)
		if eventID == "" {
			logging.SystemErrorf("[%s] Empty extracted unique identifier in: %s", destinationStorages[0].ID(), payload.DebugString())
		}

		//** Multiplexing **
		consumers := s.destinationService.GetConsumers(tokenID)
		synchronousStorages := s.destinationService.GetSynchronousStorages(tokenID)
		if len(consumers) == 0 && len(synchronousStorages) == 0 {
			counters.SkipPushSourceEvents(tokenID, 1)
			return nil, ErrNoDestinations
		}

		for _, consumer := range consumers {
			consumer.Consume(payload, tokenID)
		}

		for _, sc := range synchronousStorages {
			synchronousStorage, ok := sc.Get()
			if ok {
				syncWorker := synchronousStorage.GetSyncWorker()
				if syncWorker != nil {
					extras = append(extras, syncWorker.ProcessEvent(payload, tokenID)...)
				}
			}
		}

		var destinationIDs []string
		for _, destinationProxy := range destinationStorages {
			destinationIDs = append(destinationIDs, destinationProxy.ID())
		}
		//Retroactive users recognition
		processor.Postprocess(payload, eventID, destinationIDs, tokenID)

		counters.SuccessPushSourceEvents(tokenID, 1)
	}

	return extras, nil
}
