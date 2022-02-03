package multiplexing

import (
	"encoding/json"
	"errors"

	"github.com/jitsucom/jitsu/server/caching"
	"github.com/jitsucom/jitsu/server/counters"
	"github.com/jitsucom/jitsu/server/destinations"
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
func (s *Service) AcceptRequest(events []events.Event, emitter Emitter) error {
	tokenID := emitter.GetTokenID()
	destinationStorages := s.destinationService.GetDestinations(tokenID)
	if len(destinationStorages) == 0 {
		counters.SkipPushSourceEvents(tokenID, 1)
		return ErrNoDestinations
	}

	uniqueIDField := destinationStorages[0].GetUniqueIDField()
	for _, payload := range events {
		//** Context enrichment **
		//Note: we assume that destinations under 1 token can't have different unique ID configuration (JS SDK 2.0 or an old one)
		emitter.EnrichContext(uniqueIDField, payload)

		//Persisted cache
		//extract unique identifier
		eventID := uniqueIDField.Extract(payload)
		if eventID == "" {
			logging.SystemErrorf("[%s] Empty extracted unique identifier in: %s", destinationStorages[0].ID(), payload.DebugString())
		}

		serializedPayload, _ := json.Marshal(payload)
		destinationIDs := make([]string, 0, len(destinationStorages))
		for _, destinationProxy := range destinationStorages {
			destinationID := destinationProxy.ID()
			destinationIDs = append(destinationIDs, destinationID)
			s.eventsCache.Put(destinationProxy.IsCachingDisabled(), destinationID, eventID, serializedPayload)
		}

		//** Multiplexing **
		consumers := s.destinationService.GetConsumers(tokenID)
		if len(consumers) == 0 {
			counters.SkipPushSourceEvents(tokenID, 1)
			return ErrNoDestinations
		}

		for _, consumer := range consumers {
			consumer.Consume(payload, tokenID)
		}

		//Retroactive users recognition
		emitter.RecognizeUsers(eventID, payload, destinationIDs)

		counters.SuccessPushSourceEvents(tokenID, 1)
	}

	return nil
}
