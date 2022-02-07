package users

import (
	"encoding/json"
	"fmt"
	"github.com/hashicorp/go-multierror"
	"github.com/jitsucom/jitsu/server/config"
	"github.com/jitsucom/jitsu/server/destinations"
	"github.com/jitsucom/jitsu/server/events"
	"github.com/jitsucom/jitsu/server/jsonutils"
	"github.com/jitsucom/jitsu/server/logging"
	"github.com/jitsucom/jitsu/server/safego"
	"github.com/jitsucom/jitsu/server/timestamp"
	"go.uber.org/atomic"
	"strings"
	"sync"
	"time"
)

const retryCount = 1
const sysErrFreqSec = 10

//RecognitionService has a thread pool under the hood
//saves anonymous events in meta storage
//rewrites recognized events
type RecognitionService struct {
	storage            Storage
	destinationService *destinations.Service
	compressor         Compressor

	mutex        *sync.Mutex
	eventRetries map[string]int

	idsMutex            *sync.Mutex
	identifiedQueue     *Queue
	anonymousQueue      *Queue
	closed              *atomic.Bool
	lastSystemErrorTime time.Time
	userAgentJSONPath   jsonutils.JSONPath
}

//NewRecognitionService creates a new RecognitionService if metaStorage configuration exists
func NewRecognitionService(storage Storage, destinationService *destinations.Service, configuration *config.UsersRecognition, userAgentPath string) (*RecognitionService, error) {
	if !configuration.IsEnabled() {
		logging.Info("❌ Users recognition is not enabled. Read how to enable them: https://jitsu.com/docs/other-features/retroactive-user-recognition")
		//return closed
		return &RecognitionService{closed: atomic.NewBool(true)}, nil
	}

	if storage.Type() == DummyStorageType {
		if configuration.IsEnabled() {
			logging.Errorf("Users recognition requires 'users_recognition.redis' or 'meta.storage' configuration")
		}
		//return closed
		return &RecognitionService{closed: atomic.NewBool(true)}, nil
	}

	var compressor Compressor
	if configuration.Compression == GZIPCompressorType {
		compressor = &GZIPCompressor{}
		logging.Infof("[users recognition] uses GZIP compression")
	} else {
		compressor = &DummyCompressor{}
	}

	service := &RecognitionService{
		destinationService:  destinationService,
		storage:             storage,
		compressor:          compressor,
		mutex:               &sync.Mutex{},
		idsMutex:            &sync.Mutex{},
		eventRetries:        map[string]int{},
		identifiedQueue:     newQueue("users_identified"),
		anonymousQueue:      newQueue("users_recognition"),
		closed:              atomic.NewBool(false),
		lastSystemErrorTime: timestamp.Now().Add(time.Second * -sysErrFreqSec),
		userAgentJSONPath:   jsonutils.NewJSONPath(userAgentPath),
	}

	for i := 0; i < configuration.PoolSize; i++ {
		safego.RunWithRestart(service.startAnonymousObserver)
		safego.RunWithRestart(service.startIdentifiedObserver)
	}

	return service, nil
}

func (rs *RecognitionService) systemErrorf(format string, v ...interface{}) {
	now := timestamp.Now()
	if timestamp.Now().After(rs.lastSystemErrorTime.Add(time.Second * sysErrFreqSec)) {
		logging.SystemErrorf(format, v...)
		rs.lastSystemErrorTime = now
	}
}

func (rs *RecognitionService) startAnonymousObserver() {
	for {
		if rs.closed.Load() {
			break
		}

		rpi, err := rs.anonymousQueue.DequeueBlock()
		if err != nil {
			if rs.closed.Load() {
				continue
			}

			rs.systemErrorf("Error reading recognition payload from queue: %v", err)
			continue
		}
		rp, ok := rpi.(*AnonymousPayload)
		if !ok {
			rs.systemErrorf("wrong type of recognition payload dto in queue. Expected: *AnonymousPayload, actual: %T (%s)", rpi, rpi)
		}
		if err := rs.processAnonymousPayload(rp); err != nil {
			rs.systemErrorf("System error: %v", err)
		}
	}
}

func (rs *RecognitionService) getAggregatedIdentifiers() (map[EventKey]map[string]interface{}, error) {
	rs.idsMutex.Lock()
	defer rs.idsMutex.Unlock()

	size := rs.identifiedQueue.Size()
	if size == 0 {
		size = 1
	}
	aggregatedIdentifiers := map[EventKey]map[string]interface{}{}
	notAggrSize := 0
	for i := int64(0); i < size; i++ {
		identified, err := rs.identifiedQueue.DequeueBlock()
		if err != nil {
			return nil, fmt.Errorf("Error reading recognition payload from queue: %v", err)
		}
		eventIdentifiers, ok := identified.([]*EventIdentifiers)
		if !ok {
			return nil, fmt.Errorf("wrong type of recognition payload dto in queue. Expected: []*EventIdentifiers, actual: %T (%s)", identified, identified)
		}
		notAggrSize = notAggrSize + len(eventIdentifiers)
		for _, ids := range eventIdentifiers {
			aggregatedIdentifiers[ids.EventKey] = ids.IdentificationValues
		}
	}
	logging.Debugf("Identified events total: %d aggregated: %d", notAggrSize, len(aggregatedIdentifiers))
	return aggregatedIdentifiers, nil
}

func (rs *RecognitionService) startIdentifiedObserver() {
	for {
		if rs.closed.Load() {
			break
		}
		aggregatedIdentifiers, err := rs.getAggregatedIdentifiers()
		if err != nil {
			rs.systemErrorf("System error: %v", err)
			continue
		}

		for eventKey, values := range aggregatedIdentifiers {
			if err := rs.reprocessAnonymousEvents(eventKey, values); err != nil {
				rs.systemErrorf("System error: %v", err)
				break
			}
		}
	}
}

//Event consumes events.Event and put it to the recognition queue
func (rs *RecognitionService) Event(event events.Event, eventID string, destinationIDs []string) {
	if rs.closed.Load() {
		return
	}

	userAgent, ok := rs.userAgentJSONPath.Get(event)
	if ok {
		userAgent, ok := userAgent.(string)
		if ok {
			lcUserAgent := strings.ToLower(userAgent)
			if strings.Contains(lcUserAgent, "bot") || strings.Contains(lcUserAgent, "crawl") {
				return
			}
		}
	}

	anonymousPayload, identified := rs.getDestinationsForRecognition(event, eventID, destinationIDs)
	if len(identified) == 0 && anonymousPayload == nil {
		return
	}
	if anonymousPayload != nil {
		if err := rs.anonymousQueue.Enqueue(anonymousPayload); err != nil {
			rpBytes, _ := json.Marshal(anonymousPayload)
			rs.systemErrorf("Error saving recognition anonymous payload [%s] from event [%s] into the queue: %v", string(rpBytes), event.Serialize(), err)
			return
		}
	}
	if len(identified) > 0 {
		if err := rs.identifiedQueue.Enqueue(identified); err != nil {
			rpBytes, _ := json.Marshal(identified)
			rs.systemErrorf("Error saving recognition identified payload [%s] from event [%s] into the queue: %v", string(rpBytes), event.Serialize(), err)
			return
		}
	}

}

func (rs *RecognitionService) getDestinationsForRecognition(event events.Event, eventID string, destinationIDs []string) (rp *AnonymousPayload, identified []*EventIdentifiers) {
	identified = make([]*EventIdentifiers, 0, len(destinationIDs))
	rp = nil
	anonymousDestinationIDs := make([]EventKey, 0, len(destinationIDs))
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
		isAnyIdentificationValueFilled := false

		values, ok := configuration.IdentificationJSONPathes.Get(event)
		for _, value := range values {
			if value != nil {
				isAnyIdentificationValueFilled = true
				break
			}
		}
		if isAnyIdentificationValueFilled {
			identified = append(identified, &EventIdentifiers{EventKey: EventKey{DestinationID: destinationID, AnonymousID: anonymousIDStr}, IdentificationValues: values})
		} else {
			anonymousDestinationIDs = append(anonymousDestinationIDs, EventKey{DestinationID: destinationID, AnonymousID: anonymousIDStr})
		}
	}
	if len(anonymousDestinationIDs) > 0 {
		compressedEvent := rs.compressor.Compress(event)
		rp = &AnonymousPayload{EventID: eventID, EventBytes: compressedEvent, EventKeys: anonymousDestinationIDs}
	}
	return
}

func (rs *RecognitionService) reprocessAnonymousEvents(eventsKey EventKey, identificationValues map[string]interface{}) error {
	destinationID := eventsKey.DestinationID
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

	eventsMap, err := rs.storage.GetAnonymousEvents(destinationID, eventsKey.AnonymousID)
	if err != nil {
		return fmt.Errorf("Error getting anonymous events by destinationID: [%s] and anonymousID: [%s] from storage: %v", destinationID, eventsKey.AnonymousID, err)
	}

	if len(eventsMap) == 0 {
		return nil
	}

	for storedEventID, storedSerializedEvent := range eventsMap {
		event, err := rs.deserialize(storedSerializedEvent)
		if err != nil {
			return fmt.Errorf("[%s] error deserializing event [%s]: %v", destinationID, storedSerializedEvent, err)
			continue
		}

		if err = configuration.IdentificationJSONPathes.Set(event, identificationValues); err != nil {
			logging.Errorf("[%s] Error setting recognized user id into event: %s with json path rule [%s]: %v",
				destinationID, storedSerializedEvent, configuration.IdentificationJSONPathes.String(), err)
			continue
		}

		if err := storage.Update(event); err != nil {
			rs.mutex.Lock()
			rs.eventRetries[storedEventID]++
			count, _ := rs.eventRetries[storedEventID]
			rs.mutex.Unlock()

			if count <= retryCount {
				//retry
				continue
			}

			logging.Infof("[%s] Error updating recognition event %s after %d retries: %v", destinationID, storedSerializedEvent, retryCount, err)
		}

		// Pipeline goes only when event contains full identifiers according to settings,
		if err = rs.storage.DeleteAnonymousEvent(destinationID, eventsKey.AnonymousID, storedEventID); err != nil {
			return fmt.Errorf("error deleting anonymous events id [%s]: %v", storedEventID, err)
		}

		rs.mutex.Lock()
		delete(rs.eventRetries, storedEventID)
		rs.mutex.Unlock()
	}

	return nil
}

func (rs *RecognitionService) processAnonymousPayload(rp *AnonymousPayload) error {
	for _, eventKey := range rp.EventKeys {
		if err := rs.storage.SaveAnonymousEvent(eventKey.DestinationID, eventKey.AnonymousID, rp.EventID, string(rp.EventBytes)); err != nil {
			return fmt.Errorf("[%s] Error saving event with anonymous id %s: %v", eventKey.DestinationID, eventKey.AnonymousID, err)
		}
	}
	return nil
}

//Close sets closed flag = true (stop goroutines)
//closes the queue
func (rs *RecognitionService) Close() (multiErr error) {
	rs.closed.Store(true)

	if rs.anonymousQueue != nil {
		if err := rs.anonymousQueue.Close(); err != nil {
			multiErr = multierror.Append(multiErr, fmt.Errorf("error closing users recognition anonymous queue: %v", err))
		}
	}

	if rs.identifiedQueue != nil {
		if err := rs.identifiedQueue.Close(); err != nil {
			multiErr = multierror.Append(multiErr, fmt.Errorf("error closing users recognition identified queue: %v", err))
		}
	}

	if rs.storage != nil {
		if err := rs.storage.Close(); err != nil {
			multiErr = multierror.Append(multiErr, fmt.Errorf("error closing users recognition storage: %v", err))
		}
	}

	return
}

func (rs *RecognitionService) deserialize(payload string) (events.Event, error) {
	decompressed, compressErr := rs.compressor.Decompress([]byte(payload))
	if compressErr != nil {
		//try without compression (old event)
		event := events.Event{}
		if marshalErr := json.Unmarshal([]byte(payload), &event); marshalErr != nil {
			return nil, fmt.Errorf("unable to decompress event [%s]: %v", payload, compressErr)
		}

		return event, nil
	}

	return decompressed, nil
}
