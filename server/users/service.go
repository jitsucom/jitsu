package users

import (
	"encoding/json"
	"fmt"
	"github.com/jitsucom/jitsu/server/config"
	"github.com/jitsucom/jitsu/server/destinations"
	"github.com/jitsucom/jitsu/server/events"
	"github.com/jitsucom/jitsu/server/logging"
	"github.com/jitsucom/jitsu/server/meta"
	"github.com/jitsucom/jitsu/server/safego"
	"go.uber.org/atomic"
	"strings"
)

//RecognitionService has a thread pool under the hood
//saves anonymous events in meta storage
//rewrites recognized events
type RecognitionService struct {
	metaStorage        meta.Storage
	destinationService *destinations.Service

	queue  *Queue
	closed *atomic.Bool
}

//NewRecognitionService creates a new RecognitionService if metaStorage configuration exists
func NewRecognitionService(metaStorage meta.Storage, destinationService *destinations.Service,
	configuration *config.UsersRecognition) (*RecognitionService, error) {
	if metaStorage.Type() == meta.DummyType {
		if configuration.IsEnabled() {
			logging.Errorf("Users recognition is switched off since it requires 'meta.storage' configuration")
		}
		//return closed
		return &RecognitionService{closed: atomic.NewBool(true)}, nil
	}

	service := &RecognitionService{
		destinationService: destinationService,
		metaStorage:        metaStorage,
		queue:              newQueue(),
		closed:             atomic.NewBool(false),
	}

	for i := 0; i < configuration.PoolSize; i++ {
		safego.RunWithRestart(service.startObserver)
	}

	return service, nil
}

func (rs *RecognitionService) startObserver() {
	for {
		if rs.closed.Load() {
			break
		}

		rp, err := rs.queue.DequeueBlock()
		if err != nil {
			if rs.closed.Load() {
				continue
			}

			logging.SystemErrorf("Error reading recognition payload from queue: %v", err)
			continue
		}

		if err := rs.processRecognitionPayload(rp); err != nil {
			logging.SystemError(err)
			if err := rs.queue.Enqueue(rp); err != nil {
				logging.SystemErrorf("Error writing recognition payload [%v]: %v", rp, err)
			}
		}
	}
}

//Event consumes events.Event and put it to the recognition queue
func (rs *RecognitionService) Event(event events.Event, eventID string, destinationIDs []string) {
	if rs.closed.Load() {
		return
	}

	rp := &RecognitionPayload{Event: event, EventID: eventID, DestinationIDs: destinationIDs}
	if err := rs.queue.Enqueue(rp); err != nil {
		rpBytes, _ := json.Marshal(rp)
		logging.SystemErrorf("Error saving recognition payload [%s] from event [%s] into the queue: %v", string(rpBytes), rp.Event.Serialize(), err)
		return
	}
}

func (rs *RecognitionService) getDestinationsForRecognition(event events.Event, eventID string, destinationIDs []string) map[string]EventIdentifiers {
	identifiers := map[string]EventIdentifiers{}
	for _, destinationID := range destinationIDs {
		storageProxy, ok := rs.destinationService.GetDestinationByID(destinationID)
		if !ok {
			logging.Errorf("Error recognizing user: Destination [%s] wasn't found", destinationID)
			continue
		}

		storage, ok := storageProxy.Get()
		if !ok {
			logging.Errorf("Error recognizing user: Destination [%s] hasn't been initialized yet", destinationID)
			continue
		}

		if storage.IsStaging() {
			logging.Errorf("Error recognizing user: Destination [%s] is staged, user recognition is not allowed", destinationID)
			continue
		}

		configuration := storage.GetUsersRecognition()

		//recognition disabled or wrong pk fields configuration
		if !configuration.IsEnabled() {
			continue
		}

		anonymousID, ok := configuration.AnonymousIDJSONPath.Get(event)
		if !ok {
			logging.Warnf("[%s] Event %s doesn't have anonymous id in path: %s", destinationID, event.Serialize(), configuration.AnonymousIDJSONPath.String())
			continue
		}

		anonymousIDStr := fmt.Sprint(anonymousID)

		properties, ok := configuration.IdentificationJSONPathes.Get(event)

		identifiers[destinationID] = EventIdentifiers{
			EventID:              eventID,
			AnonymousID:          anonymousIDStr,
			IdentificationValues: properties,
		}
	}

	return identifiers
}

func (rs *RecognitionService) reprocessAnonymousEvents(destinationID string, identifiers EventIdentifiers) error {
	storageProxy, ok := rs.destinationService.GetDestinationByID(destinationID)
	if !ok {
		return fmt.Errorf("destination [%s] wasn't found", destinationID)
	}

	storage, ok := storageProxy.Get()
	if !ok {
		return fmt.Errorf("destination [%s] hasn't been initialized yet", destinationID)
	}

	configuration := storage.GetUsersRecognition()

	//recognition disabled or wrong pk fields configuration
	if !configuration.IsEnabled() {
		return nil
	}

	eventsMap, err := rs.metaStorage.GetAnonymousEvents(destinationID, identifiers.AnonymousID)
	if err != nil {
		return fmt.Errorf("Error getting anonymous events by destinationID: [%s] and anonymousID: [%s] from storage: %v", destinationID, identifiers.AnonymousID, err)
	}

	if len(eventsMap) == 0 {
		return nil
	}

	eventIDs := make([]string, 0, len(eventsMap))
	eventsArr := make([]map[string]interface{}, 0, len(eventsMap))
	for storedEventID, storedSerializedEvent := range eventsMap {
		event := events.Event{}
		if err := json.Unmarshal([]byte(storedSerializedEvent), &event); err != nil {
			logging.SystemErrorf("[%s] error deserializing event [%s]: %v", destinationID, storedSerializedEvent, err)
			continue
		}

		if err = configuration.IdentificationJSONPathes.Set(event, identifiers.IdentificationValues); err != nil {
			logging.Errorf("[%s] Error setting recognized user id into event: %s with json path rule [%s]: %v",
				destinationID, storedSerializedEvent, configuration.IdentificationJSONPathes.String(), err)
			continue
		}

		eventsArr = append(eventsArr, event)
		eventIDs = append(eventIDs, storedEventID)
	}

	if len(eventsArr) == 0 {
		return nil
	}

	if err := storage.Update(eventsArr); err != nil {
		return err
	}

	// Pipeline goes only when event contains full identifiers according to settings,
	// so all saved events will be recognized and should be removed from storage.
	if err = rs.metaStorage.DeleteAnonymousEvents(destinationID, identifiers.AnonymousID, eventIDs); err != nil {
		return fmt.Errorf("error deleting anonymous events ids [%s]: %v", strings.Join(eventIDs, ", "), err)
	}

	return nil
}

func (rs *RecognitionService) processRecognitionPayload(rp *RecognitionPayload) error {
	destinationIdentifiers := rs.getDestinationsForRecognition(rp.Event, rp.EventID, rp.DestinationIDs)

	for destinationID, identifiers := range destinationIdentifiers {
		if identifiers.IsAllIdentificationValuesFilled() {
			// Run pipeline only if all identification values were recognized,
			// it is needed to update all other anonymous events
			if err := rs.reprocessAnonymousEvents(destinationID, identifiers); err != nil {
				return fmt.Errorf("[%s] Error running recognizing pipeline: %v", destinationID, err)
			}
		} else {
			b, _ := json.Marshal(rp.Event)
			if err := rs.metaStorage.SaveAnonymousEvent(destinationID, identifiers.AnonymousID, identifiers.EventID, string(b)); err != nil {
				return fmt.Errorf("[%s] Error saving event with anonymous id %s: %v", destinationID, identifiers.AnonymousID, err)
			}
		}
	}

	return nil
}

//Close sets closed flag = true (stop goroutines)
//closes the queue
func (rs *RecognitionService) Close() error {
	rs.closed.Store(true)

	if rs.queue != nil {
		if err := rs.queue.Close(); err != nil {
			return fmt.Errorf("Error closing users recognition queue: %v", err)
		}
	}

	return nil
}
