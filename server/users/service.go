package users

import (
	"encoding/json"
	"fmt"
	"github.com/jitsucom/jitsu/server/destinations"
	"github.com/jitsucom/jitsu/server/events"
	"github.com/jitsucom/jitsu/server/jsonutils"
	"github.com/jitsucom/jitsu/server/logging"
	"github.com/jitsucom/jitsu/server/meta"
	"github.com/jitsucom/jitsu/server/metrics"
	"github.com/jitsucom/jitsu/server/safego"
	"github.com/jitsucom/jitsu/server/storages"
	"github.com/joncrlsn/dque"
)

const (
	recognitionPayloadPerFile = 2000
	queueName                 = "queue.users_recognition"
)

//RecognitionPayload is a queue dto
type RecognitionPayload struct {
	EventBytes []byte
	//map[destinationId]EventIdentifiers
	DestinationsIdentifiers map[string]EventIdentifiers
}

//EventIdentifiers is used for holding event identifiers
type EventIdentifiers struct {
	AnonymousID string
	EventID     string
	UserID      string
}

// RecognitionPayloadBuilder creates and returns a new *RecognitionPayload (must be pointer).
// This is used when we load a segment of the queue from disk.
func RecognitionPayloadBuilder() interface{} {
	return &RecognitionPayload{}
}

//RecognitionService has a thread pool under the hood
//save anonymous events in meta storage
//rewrite recognized events
type RecognitionService struct {
	metaStorage         meta.Storage
	destinationService  *destinations.Service
	globalConfiguration *storages.UserRecognitionConfiguration

	queue  *dque.DQue
	closed bool
}

//NewRecognitionService create a new RecognitionService if enabled and if metaStorage configuration exists
func NewRecognitionService(metaStorage meta.Storage, destinationService *destinations.Service, configuration *storages.UsersRecognition, logEventPath string) (*RecognitionService, error) {
	if configuration == nil || !configuration.Enabled {
		logging.Warnf("Global Users recognition is disabled. Destinations users recognition configurations will be skipped!")
		return &RecognitionService{closed: true}, nil
	}

	if metaStorage.Type() == meta.DummyType {
		logging.Warnf("Users recognition requires 'meta.storage' configuration")

		return &RecognitionService{closed: true}, nil
	}

	queue, err := dque.NewOrOpen(queueName, logEventPath, recognitionPayloadPerFile, RecognitionPayloadBuilder)
	if err != nil {
		return nil, fmt.Errorf("Error opening/creating recognized events queue [%s] in dir [%s]: %v", queueName, logEventPath, err)
	}

	rs := &RecognitionService{
		destinationService: destinationService,
		metaStorage:        metaStorage,
		globalConfiguration: &storages.UserRecognitionConfiguration{
			Enabled:             configuration.Enabled,
			AnonymousIdJsonPath: jsonutils.NewJsonPath(configuration.AnonymousIdNode),
			UserIdJsonPath:      jsonutils.NewJsonPath(configuration.UserIdNode),
		},
		queue: queue,
	}

	metrics.InitialUsersRecognitionQueueSize(queue.Size())

	rs.start()

	return rs, nil
}

func (rs *RecognitionService) start() {
	safego.RunWithRestart(func() {
		for {
			if rs.closed {
				break
			}

			iface, err := rs.queue.DequeueBlock()
			metrics.DequeuedRecognitionEvent()
			if err != nil {
				if err == dque.ErrQueueClosed && rs.closed {
					continue
				}

				logging.SystemErrorf("Error reading recognition payload from queue: %v", err)
				continue
			}

			rp, ok := iface.(*RecognitionPayload)
			if !ok {
				logging.SystemErrorf("Error parsing recognition payload from queue: wrong type %T", iface)
				continue
			}

			for destinationID, identifiers := range rp.DestinationsIdentifiers {
				//recognized
				if identifiers.UserID != "" {
					err := rs.runPipeline(destinationID, identifiers)
					if err != nil {
						logging.SystemErrorf("[%s] Error running recognizing pipeline: %v", destinationID, err)
					}
				} else {
					//still anonymous
					err := rs.metaStorage.SaveAnonymousEvent(destinationID, identifiers.AnonymousID, identifiers.EventID, string(rp.EventBytes))
					if err != nil {
						logging.SystemErrorf("[%s] Error saving event with anonymous id %s: %v", destinationID, identifiers.AnonymousID, err)
					}
				}
			}
		}
	})
}

//Event consumes events.Event and put it to the recognition queue
func (rs *RecognitionService) Event(event events.Event, destinationIds []string) {
	if rs.closed {
		return
	}

	destinationIdentifiers := rs.getDestinationsForRecognition(event, destinationIds)

	rp := &RecognitionPayload{EventBytes: []byte(event.Serialize()), DestinationsIdentifiers: destinationIdentifiers}
	err := rs.queue.Enqueue(rp)
	if err != nil {
		logging.SystemErrorf("Error saving recognition payload into the queue: %v", err)
		return
	}

	metrics.EnqueuedRecognitionEvent()
}

func (rs *RecognitionService) getDestinationsForRecognition(event events.Event, destinationIds []string) map[string]EventIdentifiers {
	identifiers := map[string]EventIdentifiers{}
	for _, destinationID := range destinationIds {
		storageProxy, ok := rs.destinationService.GetStorageById(destinationID)
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

		//override destination recognition configuration with global one
		if configuration == nil {
			configuration = rs.globalConfiguration
		}

		//recognition disabled manually or wrong pk fields configuration
		if !configuration.Enabled {
			continue
		}

		anonymousID, ok := configuration.AnonymousIdJsonPath.Get(event)
		if !ok {
			logging.Warnf("[%s] Event %s doesn't have anonymous id in path: %s", destinationID, event.Serialize(), configuration.AnonymousIdJsonPath.String())
			continue
		}

		anonymousIDStr := fmt.Sprint(anonymousID)

		var userIDStr string
		userID, ok := configuration.UserIdJsonPath.Get(event)
		if ok {
			userIDStr = fmt.Sprint(userID)
		}

		identifiers[destinationID] = EventIdentifiers{
			EventID:     events.ExtractEventId(event),
			AnonymousID: anonymousIDStr,
			UserID:      userIDStr,
		}
	}

	return identifiers
}

func (rs *RecognitionService) runPipeline(destinationID string, identifiers EventIdentifiers) error {
	eventsMap, err := rs.metaStorage.GetAnonymousEvents(destinationID, identifiers.AnonymousID)
	if err != nil {
		return fmt.Errorf("Error getting anonymous events by destinationID: [%s] and anonymousId: [%s] from storage: %v", destinationID, identifiers.AnonymousID, err)
	}

	for storedEventID, storedSerializedEvent := range eventsMap {
		event := map[string]interface{}{}
		err := json.Unmarshal([]byte(storedSerializedEvent), &event)
		if err != nil {
			logging.SystemErrorf("[%s] Error unmarshalling anonymous event [%s] from meta storage with [%s] anonymous id: %v", destinationID, storedEventID, identifiers.AnonymousID, err)
			continue
		}

		storageProxy, ok := rs.destinationService.GetStorageById(destinationID)
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

		//override destination recognition configuration with global one
		if configuration == nil {
			configuration = rs.globalConfiguration
		}

		//recognition disabled
		if !configuration.Enabled {
			continue
		}

		err = configuration.UserIdJsonPath.Set(event, identifiers.UserID)
		if err != nil {
			logging.Errorf("[%s] Error setting recognized user id into event: %s with json path rule [%s]: %v", destinationID, storedSerializedEvent, configuration.UserIdJsonPath.String(), err)
			continue
		}

		err = storage.Update(event)
		if err != nil {
			logging.SystemErrorf("[%s] Error updating recognized user event: %v", destinationID, err)
			continue
		}

		err = rs.metaStorage.DeleteAnonymousEvent(destinationID, identifiers.AnonymousID, storedEventID)
		if err != nil {
			logging.SystemErrorf("[%s] Error deleting stored recognized event [%s]: %v", destinationID, storedEventID, err)
			continue
		}
	}

	return nil
}

//Close sets closed flag = true (stop goroutines)
//closes the queue
func (rs *RecognitionService) Close() error {
	rs.closed = true

	if rs.queue != nil {
		if err := rs.queue.Close(); err != nil {
			return fmt.Errorf("Error closing users recognition queue: %v", err)
		}
	}

	return nil
}
