package users

import (
	"encoding/json"
	"fmt"
	"github.com/jitsucom/jitsu/server/destinations"
	"github.com/jitsucom/jitsu/server/events"
	"github.com/jitsucom/jitsu/server/logging"
	"github.com/jitsucom/jitsu/server/meta"
	"github.com/jitsucom/jitsu/server/safego"
	"github.com/jitsucom/jitsu/server/storages"
	"go.uber.org/atomic"
	"os"
	"path"
)

const (
	recognitionPayloadPerFile = 2000
	queueName                 = "queue.users_recognition"
	lockFile                  = "lock.lock"
)

//RecognitionService has a thread pool under the hood
//saves anonymous events in meta storage
//rewrites recognized events
type RecognitionService struct {
	metaStorage        meta.Storage
	destinationService *destinations.Service

	queue  *LevelDBQueue
	closed *atomic.Bool
}

//NewRecognitionService creates a new RecognitionService if metaStorage configuration exists
func NewRecognitionService(metaStorage meta.Storage, destinationService *destinations.Service, configuration *storages.UsersRecognition, logEventPath string) (*RecognitionService, error) {
	if metaStorage.Type() == meta.DummyType {
		if configuration.IsEnabled() {
			logging.Errorf("Users recognition requires 'meta.storage' configuration")
		}
		return &RecognitionService{closed: atomic.NewBool(false)}, nil
	}

	queue, err := NewLevelDBQueue(queueName, logEventPath)
	if err != nil {
		return nil, fmt.Errorf("Error opening/creating recognized events queue [%s] in dir [%s]: %v", queueName, logEventPath, err)
	}

	rs := &RecognitionService{
		destinationService: destinationService,
		metaStorage:        metaStorage,
		queue:              queue,
		closed:             atomic.NewBool(false),
	}

	rs.start()

	return rs, nil
}

func (rs *RecognitionService) start() {
	safego.RunWithRestart(func() {
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

			for destinationID, identifiers := range rp.DestinationsIdentifiers {
				if identifiers.IsAllIdentificationValuesFilled() {
					// Run pipeline only if all identification values were recognized,
					// it is needed to update all other anonymous events
					err = rs.runPipeline(destinationID, identifiers)
					if err != nil {
						logging.SystemErrorf("[%s] Error running recognizing pipeline: %v", destinationID, err)
					}
				} else {
					// If some identification value is missing - event is still anonymous
					err = rs.metaStorage.SaveAnonymousEvent(destinationID, identifiers.AnonymousID, identifiers.EventID, string(rp.EventBytes))
					if err != nil {
						logging.SystemErrorf("[%s] Error saving event with anonymous id %s: %v", destinationID, identifiers.AnonymousID, err)
					}
				}
			}
		}
	})
}

//Event consumes events.Event and put it to the recognition queue
func (rs *RecognitionService) Event(event events.Event, eventID string, destinationIDs []string) {
	if rs.closed.Load() {
		return
	}

	destinationIdentifiers := rs.getDestinationsForRecognition(event, eventID, destinationIDs)

	rp := &RecognitionPayload{EventBytes: []byte(event.Serialize()), DestinationsIdentifiers: destinationIdentifiers}
	if err := rs.queue.Enqueue(rp); err != nil {
		logging.SystemErrorf("Error saving recognition payload into the queue: %v", err)
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

func (rs *RecognitionService) runPipeline(destinationID string, identifiers EventIdentifiers) error {
	eventsMap, err := rs.metaStorage.GetAnonymousEvents(destinationID, identifiers.AnonymousID)
	if err != nil {
		return fmt.Errorf("Error getting anonymous events by destinationID: [%s] and anonymousID: [%s] from storage: %v", destinationID, identifiers.AnonymousID, err)
	}

	for storedEventID, storedSerializedEvent := range eventsMap {
		event := events.Event{}
		err := json.Unmarshal([]byte(storedSerializedEvent), &event)
		if err != nil {
			logging.SystemErrorf("[%s] Error unmarshalling anonymous event [%s] from meta storage with [%s] anonymous id: %v", destinationID, storedEventID, identifiers.AnonymousID, err)
			continue
		}

		storageProxy, ok := rs.destinationService.GetDestinationByID(destinationID)
		if !ok {
			logging.Errorf("Error running recognizing user pipeline: Destination [%s] wasn't found", destinationID)
			continue
		}

		storage, ok := storageProxy.Get()
		if !ok {
			logging.Errorf("Error running recognizing user pipeline: Destination [%s] hasn't been initialized yet", destinationID)
			continue
		}

		configuration := storage.GetUsersRecognition()

		//recognition disabled or wrong pk fields configuration
		if !configuration.IsEnabled() {
			continue
		}

		err = configuration.IdentificationJSONPathes.Set(event, identifiers.IdentificationValues)
		if err != nil {
			logging.Errorf("[%s] Error setting recognized user id into event: %s with json path rule [%s]: %v",
				destinationID, storedSerializedEvent, configuration.IdentificationJSONPathes.String(), err)
			continue
		}

		err = storage.Update(event)
		if err != nil {
			logging.SystemErrorf("[%s] Error updating recognized user event: %v", destinationID, err)
			continue
		}

		// Pipeline goes only when event contains full identifiers according to settings,
		// so all saved events will be recognized and should be removed from storage.
		err = rs.metaStorage.DeleteAnonymousEvent(destinationID, identifiers.AnonymousID, storedEventID)
		if err != nil {
			logging.SystemErrorf("[%s] Error deleting stored recognized event [%s]: %v", destinationID, storedEventID, err)
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

//unlockDQue workaround for github.com/joncrlsn/dque forgetting to release file lock
func unlockDQue(dirPath string, name string) error {
	l := path.Join(dirPath, name, lockFile)
	if err := os.Remove(l); err != nil {
		return fmt.Errorf("Failed to remove lock file %s: %v", l, err)
	}
	return nil
}
