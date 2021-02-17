package users

import (
	"encoding/json"
	"fmt"
	"github.com/jitsucom/eventnative/destinations"
	"github.com/jitsucom/eventnative/events"
	"github.com/jitsucom/eventnative/jsonutils"
	"github.com/jitsucom/eventnative/logging"
	"github.com/jitsucom/eventnative/meta"
	"github.com/jitsucom/eventnative/safego"
	"github.com/jitsucom/eventnative/storages"
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
	AnonymousId string
	EventId     string
	UserId      string
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
	if configuration == nil || !configuration.Enabled || metaStorage.Type() == meta.DummyType {
		if metaStorage != nil && metaStorage.Type() == meta.DummyType {
			logging.Warnf("Users recognition required meta storage configuration")
		}

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

			for destinationId, identifiers := range rp.DestinationsIdentifiers {
				//recognized
				if identifiers.UserId != "" {
					err := rs.runPipeline(destinationId, identifiers)
					if err != nil {
						logging.SystemErrorf("[%s] Error running recognizing pipeline: %v", destinationId, err)
					}
				} else {
					//still anonymous
					err := rs.metaStorage.SaveAnonymousEvent(destinationId, identifiers.AnonymousId, identifiers.EventId, string(rp.EventBytes))
					if err != nil {
						logging.SystemErrorf("[%s] Error saving event with anonymous id %s: %v", destinationId, identifiers.AnonymousId, err)
					}
				}
			}
		}
	})
}

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
}

func (rs *RecognitionService) getDestinationsForRecognition(event events.Event, destinationIds []string) map[string]EventIdentifiers {
	identifiers := map[string]EventIdentifiers{}
	for _, destinationId := range destinationIds {
		storageProxy, ok := rs.destinationService.GetStorageById(destinationId)
		if !ok {
			logging.Errorf("Error recognizing user: Destination [%s] wasn't found", destinationId)
			continue
		}

		storage, ok := storageProxy.Get()
		if !ok {
			logging.Errorf("Error recognizing user: Destination [%s] hasn't been initialized yet", destinationId)
			continue
		}

		if storage.IsStaging() {
			logging.Errorf("Error recognizing user: Destination [%s] is staged, user recognition is not allowed", destinationId)
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

		anonymousId, ok := configuration.AnonymousIdJsonPath.Get(event)
		if !ok {
			logging.Warnf("[%s] Event %s doesn't have anonymous id in path: %s", destinationId, event.Serialize(), configuration.AnonymousIdJsonPath.String())
			continue
		}

		anonymousIdStr := fmt.Sprint(anonymousId)

		var userIdStr string
		userId, ok := configuration.UserIdJsonPath.Get(event)
		if ok {
			userIdStr = fmt.Sprint(userId)
		}

		identifiers[destinationId] = EventIdentifiers{
			EventId:     events.ExtractEventId(event),
			AnonymousId: anonymousIdStr,
			UserId:      userIdStr,
		}
	}

	return identifiers
}

func (rs *RecognitionService) runPipeline(destinationId string, identifiers EventIdentifiers) error {
	eventsMap, err := rs.metaStorage.GetAnonymousEvents(destinationId, identifiers.AnonymousId)
	if err != nil {
		return fmt.Errorf("Error getting anonymous events by destinationId: [%s] and anonymousId: [%s] from storage: %v", destinationId, identifiers.AnonymousId, err)
	}

	for storedEventId, storedSerializedEvent := range eventsMap {
		event := map[string]interface{}{}
		err := json.Unmarshal([]byte(storedSerializedEvent), &event)
		if err != nil {
			logging.SystemErrorf("[%s] Error unmarshalling anonymous event [%s] from meta storage with [%s] anonymous id: %v", destinationId, storedEventId, identifiers.AnonymousId, err)
			continue
		}

		storageProxy, ok := rs.destinationService.GetStorageById(destinationId)
		if !ok {
			logging.Errorf("Error running recognizing user pipeline: Destination [%s] wasn't found", destinationId)
			continue
		}

		storage, ok := storageProxy.Get()
		if !ok {
			logging.Errorf("Error running recognizing user pipeline: Destination [%s] hasn't been initialized yet", destinationId)
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

		err = configuration.UserIdJsonPath.Set(event, identifiers.UserId)
		if err != nil {
			logging.Errorf("[%s] Error setting recognized user id into event: %s with json path rule [%s]: %v", destinationId, storedSerializedEvent, configuration.UserIdJsonPath.String(), err)
			continue
		}

		_, err = storage.SyncStore(nil, []map[string]interface{}{event}, "")
		if err != nil {
			logging.SystemErrorf("[%s] Error storing recognized user event: %v", destinationId, err)
			continue
		}

		err = rs.metaStorage.DeleteAnonymousEvent(destinationId, identifiers.AnonymousId, storedEventId)
		if err != nil {
			logging.SystemErrorf("[%s] Error deleting stored recognized event [%s]: %v", destinationId, storedEventId, err)
			continue
		}
	}

	return nil
}

func (rs *RecognitionService) Close() error {
	rs.closed = true

	if rs.queue != nil {
		if err := rs.queue.Close(); err != nil {
			return fmt.Errorf("Error closing users recognition queue: %v", err)
		}
	}

	return nil
}
