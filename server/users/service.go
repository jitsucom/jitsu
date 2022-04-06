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
	"github.com/jitsucom/jitsu/server/metrics"
	"github.com/jitsucom/jitsu/server/safego"
	"github.com/jitsucom/jitsu/server/schema"
	"github.com/jitsucom/jitsu/server/storages"
	"github.com/jitsucom/jitsu/server/timestamp"
	"go.uber.org/atomic"
	"hash/maphash"
	"strings"
	"time"
)

const useIdentifiedCacheAfterMin = time.Minute * 1
const sysErrFreqSec = 10

//RecognitionService has a thread pool under the hood
//saves anonymous events in meta storage
//rewrites recognized events
type RecognitionService struct {
	storage            Storage
	destinationService *destinations.Service
	compressor         Compressor

	identifiedIdsCache map[string]time.Time
	cacheTTLMin        int64
	identifiedQueue    *Queue
	aggregatedQueues   []*Queue
	//to select aggregatedQueue based on hash from anonymousId
	hasher              maphash.Hash
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

	aggregatedQueues := make([]*Queue, configuration.PoolSize)
	for i := 0; i < configuration.PoolSize; i++ {
		aggregatedQueues[i] = newQueue(AggregatedQueueName, 100_000/configuration.PoolSize)
	}
	service := &RecognitionService{
		destinationService:  destinationService,
		storage:             storage,
		compressor:          compressor,
		identifiedIdsCache:  map[string]time.Time{},
		cacheTTLMin:         int64(configuration.CacheTTLMin),
		identifiedQueue:     newQueue(IdentifiedQueueName, 500_000),
		aggregatedQueues:    aggregatedQueues,
		anonymousQueue:      newQueue(AnonymousQueueName, 1_000_000),
		closed:              atomic.NewBool(false),
		lastSystemErrorTime: timestamp.Now().Add(time.Second * -sysErrFreqSec),
		userAgentJSONPath:   jsonutils.NewJSONPath(userAgentPath),
		configuration: &storages.UserRecognitionConfiguration{
			Enabled:                  configuration.IsEnabled(),
			AnonymousIDJSONPath:      jsonutils.NewJSONPath(configuration.AnonymousIDNode),
			IdentificationJSONPathes: jsonutils.NewJSONPaths(configuration.IdentificationNodes),
		},
	}

	safego.RunWithRestart(service.startIdentifiedObserver)
	for i := 0; i < configuration.PoolSize; i++ {
		safego.RunWithRestart(service.startAnonymousObserver)
		queueNum := i
		safego.RunWithRestart(func() {
			service.startAggregatedIdentifiedObserver(aggregatedQueues[queueNum])
		})
	}

	return service, nil
}

func (rs *RecognitionService) systemErrorf(format string, v ...interface{}) {
	now := timestamp.Now()
	if now.After(rs.lastSystemErrorTime.Add(time.Second * sysErrFreqSec)) {
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
		rp, ok := rpi.(*RecognitionPayload)
		if !ok {
			rs.systemErrorf("wrong type of recognition payload dto in queue. Expected: *RecognitionPayload, actual: %T (%s)", rpi, rpi)
		}
		if rp.IdentificationValues != nil {
			//identified event
			metrics.RecognitionEvent(metrics.IdentifiedEvents, rp.EventKey.TokenID, 1)
			if err := rs.identifiedQueue.Enqueue(rp); err != nil {
				rpBytes, _ := json.Marshal(rp)
				rs.systemErrorf("Error saving recognition identified payload [%s] from event [%s] into the queue: %v", string(rpBytes), rp.EventID, err)
				return
			}
		} else {
			metrics.RecognitionEvent(metrics.AnonymousEvents, rp.EventKey.TokenID, 1)
			if err := rs.storage.SaveAnonymousEvent(rp.EventKey.TokenID, rp.EventKey.AnonymousID, rp.EventID, rp.AnonymousEventBytes); err != nil {
				rs.systemErrorf("System error: [%s] Error saving event with anonymous id %s: %v", rp.EventKey.TokenID, rp.EventKey.AnonymousID, err)
			}
		}
	}
}

func (rs *RecognitionService) getAggregatedIdentifiers() (map[EventKey]map[string]interface{}, error) {
	size := rs.identifiedQueue.Size()
	if size == 0 {
		size = 1
	}
	aggregatedIdentifiers := map[EventKey]map[string]interface{}{}
	notAggrSize := 0
	for i := int64(0); i < size; i++ {
		identified, err := rs.identifiedQueue.DequeueBlock()
		if err != nil {
			if rs.closed.Load() {
				break
			}
			return nil, fmt.Errorf("Error reading recognition payload from queue: %v", err)
		}
		ids, ok := identified.(*RecognitionPayload)
		if !ok {
			return nil, fmt.Errorf("wrong type of recognition payload dto in queue. Expected: []*EventIdentifiers, actual: %T (%s)", identified, identified)
		}
		wasIdentified, ok := rs.identifiedIdsCache[ids.EventKey.AnonymousID]
		if ok {
			if timestamp.Now().After(wasIdentified.Add(time.Minute * time.Duration(rs.cacheTTLMin))) {
				//ttl expired
				rs.identifiedIdsCache[ids.EventKey.AnonymousID] = timestamp.Now()
			} else if timestamp.Now().After(wasIdentified.Add(useIdentifiedCacheAfterMin)) {
				//this anonymous user was already identified. cache hit
				metrics.RecognitionEvent(metrics.IdentifiedCacheHits, ids.EventKey.TokenID, 1)
				continue
			}
		} else {
			rs.identifiedIdsCache[ids.EventKey.AnonymousID] = timestamp.Now()
		}
		if len(rs.identifiedIdsCache) > 10_000 {
			//clear cache to avoid side effects and high memory consumption
			rs.identifiedIdsCache = map[string]time.Time{}
		}
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
			_, _ = rs.hasher.WriteString(eventKey.AnonymousID)
			aggregated := &RecognitionPayload{EventKey: eventKey, IdentificationValues: values}
			//we need to avoid processing of events of the same user concurrently because we don't work with redis in atomic fashion
			queueNum := rs.hasher.Sum64() % uint64(len(rs.aggregatedQueues))
			rs.hasher.Reset()
			if err := rs.aggregatedQueues[queueNum].Enqueue(aggregated); err != nil {
				rpBytes, _ := json.Marshal(aggregated)
				rs.systemErrorf("Error saving recognition identified payload [%s] from anonynous id [%s] into the queue: %v", string(rpBytes), eventKey.AnonymousID, err)
				return
			}
		}
		//wait a little to collect IDs to increase effectiveness of aggregation
		time.Sleep(time.Second * 10)
	}
}

func (rs *RecognitionService) startAggregatedIdentifiedObserver(queue *Queue) {
	for {
		if rs.closed.Load() {
			break
		}
		eventIdentifiers, err := queue.DequeueBlock()
		if err != nil {
			if rs.closed.Load() {
				continue
			}
			rs.systemErrorf("Error reading recognition payload from queue: %v", err)
			continue
		}
		ids, ok := eventIdentifiers.(*RecognitionPayload)
		if !ok {
			rs.systemErrorf("wrong type of recognition payload dto in queue. Expected: *EventIdentifiers, actual: %T (%s)", eventIdentifiers, eventIdentifiers)
		}
		if err := rs.reprocessAnonymousEvents(ids.EventKey, ids.IdentificationValues); err != nil {
			rs.systemErrorf("System error: %v", err)
			break
		}
	}
}

//Event consumes events.Event and put it to the recognition queue
func (rs *RecognitionService) Event(event events.Event, eventID string, destinationIDs []string, tokenID string) {
	if rs.closed.Load() {
		return
	}
	metrics.RecognitionEvent(metrics.TotalEvents, tokenID, 1)
	userAgent, ok := rs.userAgentJSONPath.Get(event)
	if ok {
		userAgent, ok := userAgent.(string)
		if ok {
			lcUserAgent := strings.ToLower(userAgent)
			if strings.Contains(lcUserAgent, "bot") || strings.Contains(lcUserAgent, "crawl") {
				metrics.RecognitionEvent(metrics.BotEvents, tokenID, 1)
				return
			}
		}
	}

	anonymousPayload := rs.extractPayload(event, eventID, destinationIDs, tokenID)
	if anonymousPayload != nil {
		if err := rs.anonymousQueue.Enqueue(anonymousPayload); err != nil {
			rpBytes, _ := json.Marshal(anonymousPayload)
			rs.systemErrorf("Error saving recognition anonymous payload [%s] from event [%s] into the queue: %v", string(rpBytes), event.DebugString(), err)
			return
		}
	}
}

func (rs *RecognitionService) extractPayload(event events.Event, eventID string, destinationIDs []string, tokenID string) (rp *RecognitionPayload) {
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
		rp = &RecognitionPayload{EventID: eventID, EventKey: EventKey{AnonymousID: anonymousIDStr, TokenID: tokenID}, IdentificationValues: values}
	} else {
		compressedEvent := rs.compressor.Compress(event)
		rp = &RecognitionPayload{EventID: eventID, AnonymousEventBytes: string(compressedEvent), EventKey: EventKey{AnonymousID: anonymousIDStr, TokenID: tokenID}}
	}
	return
}

func (rs *RecognitionService) reprocessAnonymousEvents(eventsKey EventKey, identificationValues map[string]interface{}) error {
	tokenID := eventsKey.TokenID
	metrics.RecognitionEvent(metrics.IdentifiedAggregatedEvents, tokenID, 1)

	eventsMap, err := rs.storage.GetAnonymousEvents(tokenID, eventsKey.AnonymousID)
	if err != nil {
		return fmt.Errorf("Error getting anonymous events by tokenID: [%s] and anonymousID: [%s] from storage: %v", tokenID, eventsKey.AnonymousID, err)
	}

	if len(eventsMap) == 0 {
		return nil
	}
	toDelete := make([]string, 0, len(eventsMap))

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
		metrics.RecognitionEvent(metrics.RecognizedEvents, tokenID, 1)
		consumers := rs.destinationService.GetConsumers(tokenID)
		if len(consumers) == 0 {
			return fmt.Errorf("User Recognition. Couldn't get consumer for tokenID: %s", tokenID)
		}
		event[schema.JitsuUserRecognizedEvent] = 1
		for _, consumer := range consumers {
			consumer.Consume(event, eventsKey.TokenID)
		}
		toDelete = append(toDelete, storedEventID)
	}
	if len(toDelete) > 0 {
		if err = rs.storage.DeleteAnonymousEvent(tokenID, eventsKey.AnonymousID, toDelete...); err != nil {
			return fmt.Errorf("error deleting anonymous events ids [%+v]: %v", toDelete, err)
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

	for i, queue := range rs.aggregatedQueues {
		if err := queue.Close(); err != nil {
			multiErr = multierror.Append(multiErr, fmt.Errorf("error closing users recognition aggregated queue #%d: %v", i, err))
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
