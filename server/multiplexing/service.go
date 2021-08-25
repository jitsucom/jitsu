package multiplexing

import (
	"errors"
	"github.com/jitsucom/jitsu/server/appconfig"
	"github.com/jitsucom/jitsu/server/caching"
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
	eventsCache        *caching.EventsCache
}

//NewService returns configured Service instance
func NewService(destinationService *destinations.Service, eventsCache *caching.EventsCache) *Service {
	return &Service{
		destinationService: destinationService,
		eventsCache:        eventsCache,
	}
}

//AcceptRequest multiplexes input events, enriches with context and sends to consumers
func (s *Service) AcceptRequest(processor events.Processor, reqContext *events.RequestContext, token string, eventsArray []events.Event) error {
	tokenID := appconfig.Instance.AuthorizationService.GetTokenID(token)
	destinationStorages := s.destinationService.GetDestinations(tokenID)
	if len(destinationStorages) == 0 {
		counters.SkipSourceEvents(tokenID, 1)
		return ErrNoDestinations
	}

	for _, payload := range eventsArray {
		//** Context enrichment **
		//Note: we assume that destinations under 1 token can't have different unique ID configuration (JS SDK 2.0 or an old one)
		enrichment.ContextEnrichmentStep(payload, token, reqContext, processor, destinationStorages[0].GetUniqueIDField())

		//** Caching **
		//clone payload for preventing concurrent changes while serialization
		cachingEvent := payload.Clone()

		//Persisted cache
		//extract unique identifier
		eventID := destinationStorages[0].GetUniqueIDField().Extract(payload)
		if eventID == "" {
			logging.SystemErrorf("[%s] Empty extracted unique identifier in: %s", destinationStorages[0].ID(), payload.Serialize())
		}
		var destinationIDs []string
		for _, destinationProxy := range destinationStorages {
			destinationIDs = append(destinationIDs, destinationProxy.ID())
			s.eventsCache.Put(destinationProxy.IsCachingDisabled(), destinationProxy.ID(), eventID, cachingEvent)
		}

		//** Multiplexing **
		consumers := s.destinationService.GetConsumers(tokenID)
		if len(consumers) == 0 {
			counters.SkipSourceEvents(tokenID, 1)
			return ErrNoDestinations
		}

		for _, consumer := range consumers {
			consumer.Consume(payload, tokenID)
		}

		//Retroactive users recognition
		processor.Postprocess(payload, eventID, destinationIDs)

		counters.SuccessSourceEvents(tokenID, 1)
	}

	return nil
}
