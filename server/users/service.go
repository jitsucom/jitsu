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
	"github.com/jitsucom/jitsu/server/schema"
	"github.com/jitsucom/jitsu/server/storages"
	"github.com/jitsucom/jitsu/server/timestamp"
	"go.uber.org/atomic"
	"strings"
	"sync"
	"time"
)

const useIdentifiedCacheAfterMin = time.Minute * 5
const sysErrFreqSec = 10

//RecognitionService has a thread pool under the hood
//saves anonymous events in meta storage
//rewrites recognized events
type RecognitionService struct {
	storage            Storage
	destinationService *destinations.Service
	compressor         Compressor

	mutex               *sync.Mutex
	idsMutex            *sync.Mutex
	identifiedIdsCache  map[string]time.Time
	cacheTTLMin         int64
	identifiedQueue     *Queue
	anonymousQueue      *Queue
	closed              *atomic.Bool
	lastSystemErrorTime time.Time
	userAgentJSONPath   jsonutils.JSONPath
	configuration       *storages.UserRecognitionConfiguration
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
		identifiedIdsCache:  map[string]time.Time{},
		cacheTTLMin:         int64(configuration.CacheTTLMin),
		identifiedQueue:     newQueue(IdentifiedQueueName),
		anonymousQueue:      newQueue(AnonymousQueueName),
		closed:              atomic.NewBool(false),
		lastSystemErrorTime: timestamp.Now().Add(time.Second * -sysErrFreqSec),
		userAgentJSONPath:   jsonutils.NewJSONPath(userAgentPath),
		configuration: &storages.UserRecognitionConfiguration{
			Enabled:                  configuration.IsEnabled(),
			AnonymousIDJSONPath:      jsonutils.NewJSONPath(configuration.AnonymousIDNode),
			IdentificationJSONPathes: jsonutils.NewJSONPaths(configuration.IdentificationNodes),
		},
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
		if err := rs.storage.SaveAnonymousEvent(rp.EventKey.TokenID, rp.EventKey.AnonymousID, rp.EventID, string(rp.EventBytes)); err != nil {
			rs.systemErrorf("System error: [%s] Error saving event with anonymous id %s: %v", rp.EventKey.TokenID, rp.EventKey.AnonymousID, err)
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
		ids, ok := identified.(*EventIdentifiers)
		if !ok {
			return nil, fmt.Errorf("wrong type of recognition payload dto in queue. Expected: []*EventIdentifiers, actual: %T (%s)", identified, identified)
		}
		wasIdentified, ok := rs.identifiedIdsCache[ids.EventKey.AnonymousID]
		if ok && (timestamp.Now().After(wasIdentified.Add(useIdentifiedCacheAfterMin)) &&
			timestamp.Now().Before(wasIdentified.Add(time.Minute*time.Duration(rs.cacheTTLMin)))) {
			//this anonymous user was already identified. cache hit
			continue
		}
		if len(rs.identifiedIdsCache) > 10_000 {
			//clear cache to avoid side effects and high memory consumption
			rs.identifiedIdsCache = map[string]time.Time{}
		}
		rs.identifiedIdsCache[ids.EventKey.AnonymousID] = timestamp.Now()
		notAggrSize = notAggrSize + 1
		aggregatedIdentifiers[ids.EventKey] = ids.IdentificationValues
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
func (rs *RecognitionService) Event(event events.Event, eventID string, destinationIDs []string, tokenID string) {
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

	anonymousPayload, identified := rs.extractPayload(event, eventID, destinationIDs, tokenID)
	if identified == nil && anonymousPayload == nil {
		return
	}
	if anonymousPayload != nil {
		if err := rs.anonymousQueue.Enqueue(anonymousPayload); err != nil {
			rpBytes, _ := json.Marshal(anonymousPayload)
			rs.systemErrorf("Error saving recognition anonymous payload [%s] from event [%s] into the queue: %v", string(rpBytes), event.DebugString(), err)
			return
		}
	}
	if identified != nil {
		if err := rs.identifiedQueue.Enqueue(identified); err != nil {
			rpBytes, _ := json.Marshal(identified)
			rs.systemErrorf("Error saving recognition identified payload [%s] from event [%s] into the queue: %v", string(rpBytes), event.DebugString(), err)
			return
		}
	}

}

func (rs *RecognitionService) extractPayload(event events.Event, eventID string, destinationIDs []string, tokenID string) (rp *AnonymousPayload, identified *EventIdentifiers) {
	hasUserRecognitionEnabled := false
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
		if configuration.IsEnabled() {
			hasUserRecognitionEnabled = true
			break
		}
	}
	if !hasUserRecognitionEnabled {
		return
	}

	anonymousID, ok := rs.configuration.AnonymousIDJSONPath.Get(event)
	if !ok {
		logging.Debugf("[%s] Event %s doesn't have anonymous id in path: %s", tokenID, event.DebugString(), rs.configuration.AnonymousIDJSONPath.String())
		return
	}

	anonymousIDStr := fmt.Sprint(anonymousID)
	isAnyIdentificationValueFilled := false

	values, ok := rs.configuration.IdentificationJSONPathes.Get(event)

	for _, value := range values {
		if value != nil {
			isAnyIdentificationValueFilled = true
			break
		}
	}
	if isAnyIdentificationValueFilled {
		identified = &EventIdentifiers{EventKey: EventKey{AnonymousID: anonymousIDStr, TokenID: tokenID}, IdentificationValues: values}
	} else {
		compressedEvent := rs.compressor.Compress(event)
		rp = &AnonymousPayload{EventID: eventID, EventBytes: compressedEvent, EventKey: EventKey{AnonymousID: anonymousIDStr, TokenID: tokenID}}
	}
	return
}

func (rs *RecognitionService) reprocessAnonymousEvents(eventsKey EventKey, identificationValues map[string]interface{}) error {
	tokenID := eventsKey.TokenID

	eventsMap, err := rs.storage.GetAnonymousEvents(tokenID, eventsKey.AnonymousID)
	if err != nil {
		return fmt.Errorf("Error getting anonymous events by tokenID: [%s] and anonymousID: [%s] from storage: %v", tokenID, eventsKey.AnonymousID, err)
	}

	if len(eventsMap) == 0 {
		return nil
	}

	for storedEventID, storedSerializedEvent := range eventsMap {
		event, err := rs.deserialize(storedSerializedEvent)
		if err != nil {
			return fmt.Errorf("[%s] error deserializing event [%s]: %v", tokenID, storedSerializedEvent, err)
		}

		if err = rs.configuration.IdentificationJSONPathes.Set(event, identificationValues); err != nil {
			logging.Errorf("[%s] Error setting recognized user id into event: %s with json path rule [%s]: %v",
				tokenID, storedSerializedEvent, rs.configuration.IdentificationJSONPathes.String(), err)
			continue
		}
		consumers := rs.destinationService.GetConsumers(tokenID)
		if len(consumers) == 0 {
			return fmt.Errorf("User Recognition. Couldn't get consumer for tokenID: %s", tokenID)
		}
		event[schema.JitsuUserRecognizedEvent] = 1
		for _, consumer := range consumers {
			consumer.Consume(event, eventsKey.TokenID)
		}

		if err = rs.storage.DeleteAnonymousEvent(tokenID, eventsKey.AnonymousID, storedEventID); err != nil {
			return fmt.Errorf("error deleting anonymous events id [%s]: %v", storedEventID, err)
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
