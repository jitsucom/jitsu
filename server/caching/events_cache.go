package caching

import (
	"encoding/json"
	"fmt"
	"github.com/jitsucom/jitsu/server/adapters"
	"github.com/jitsucom/jitsu/server/logging"
	"github.com/jitsucom/jitsu/server/meta"
	"github.com/jitsucom/jitsu/server/safego"
	"github.com/jitsucom/jitsu/server/timestamp"
	"github.com/jitsucom/jitsu/server/uuid"
	"math/rand"
	"sync"
	"time"
)

//EventsCache is an event cache based on meta.Storage(Redis)
type EventsCache struct {
	storage             meta.Storage
	rawEventsChannel    chan *rawEvent
	statusEventsChannel chan *statusEvent

	capacityPerTokenOrDestination int
	poolSize                      int
	timeWindow                    time.Duration
	trimInterval                  time.Duration
	lastDestinations              sync.Map
	lastTokens                    sync.Map
	lastDestinationsErrors        sync.Map
	lastTokensErrors              sync.Map
	rateLimiters                  sync.Map

	doneOnce *sync.Once
	done     chan struct{}
}

//NewEventsCache returns EventsCache and start goroutine for async operations
func NewEventsCache(enabled bool, storage meta.Storage, capacityPerTokenOrDestination, poolSize, trimIntervalMs, timeWindowSeconds int) *EventsCache {
	done := make(chan struct{})
	doneOnce := &sync.Once{}

	if !enabled {
		logging.Warnf("Events cache is disabled.")
		doneOnce.Do(func() {
			close(done)
		})
		//return closed
		return &EventsCache{
			doneOnce: doneOnce,
			done:     done,
		}
	}

	if storage.Type() == meta.DummyType {
		logging.Warnf("Events cache is disabled. Since 'meta.storage' configuration is required.")

		doneOnce.Do(func() {
			close(done)
		})
		//return closed
		return &EventsCache{
			doneOnce: doneOnce,
			done:     done,
		}
	}

	c := &EventsCache{
		storage:                       storage,
		rawEventsChannel:              make(chan *rawEvent, capacityPerTokenOrDestination*10),
		statusEventsChannel:           make(chan *statusEvent, capacityPerTokenOrDestination*10),
		capacityPerTokenOrDestination: capacityPerTokenOrDestination,
		lastDestinations:              sync.Map{},
		lastTokens:                    sync.Map{},
		lastDestinationsErrors:        sync.Map{},
		lastTokensErrors:              sync.Map{},
		rateLimiters:                  sync.Map{},
		poolSize:                      poolSize,
		timeWindow:                    time.Second * time.Duration(timeWindowSeconds),
		trimInterval:                  time.Millisecond * time.Duration(trimIntervalMs),

		done:     done,
		doneOnce: doneOnce,
	}

	for i := 0; i < poolSize; i++ {
		c.start()
	}
	c.startTrimmer()
	return c
}

//start two goroutines:
// 1. for raw events
// 2. for events with statuses
func (ec *EventsCache) start() {
	safego.RunWithRestart(func() {
		for cf := range ec.rawEventsChannel {
			ec.saveTokenEvent(cf.tokenID, cf.serializedPayload, cf.serializedMalformedPayload, cf.error, cf.skip, cf.eventMetaStatus)
		}
	})

	safego.RunWithRestart(func() {
		for cf := range ec.statusEventsChannel {
			eventEntity, err := ec.createEventEntity(cf)
			if err != nil {
				logging.Errorf("[%s] failed to create meta event entity [%v] before saving in the cache: %v", cf.destinationID, cf, err)
				continue
			}

			if err := ec.saveDestinationEventWithStatus(eventEntity, cf.eventMetaStatus); err != nil {
				logging.Errorf("[%s] failed to save meta event entity [%v] into the cache: %v", cf.destinationID, cf, err)
				continue
			}
		}
	})
}

//start goroutine for trimming events cache by deleting old cached events
func (ec *EventsCache) startTrimmer() {
	safego.RunWithRestart(func() {
		ticker := time.NewTicker(ec.trimInterval)
		for {
			select {
			case <-ec.done:
				return
			case <-ticker.C:
				ec.lastDestinations.Range(func(destinationID interface{}, value interface{}) bool {
					ec.lastDestinations.Delete(destinationID)
					err := ec.storage.TrimEvents(meta.EventsDestinationNamespace, destinationID.(string), meta.EventsPureStatus, ec.capacityPerTokenOrDestination)
					if err != nil {
						logging.Warnf("failed to trim events cache events for %s destination: %v", destinationID, err)
					}
					return true
				})

				ec.lastTokens.Range(func(tokenID interface{}, value interface{}) bool {
					ec.lastTokens.Delete(tokenID)
					err := ec.storage.TrimEvents(meta.EventsTokenNamespace, tokenID.(string), meta.EventsPureStatus, ec.capacityPerTokenOrDestination)
					if err != nil {
						logging.Warnf("failed to trim events cache events for %s token: %v", tokenID, err)
					}
					return true
				})

				ec.lastDestinationsErrors.Range(func(destinationID interface{}, value interface{}) bool {
					ec.lastDestinationsErrors.Delete(destinationID)
					err := ec.storage.TrimEvents(meta.EventsDestinationNamespace, destinationID.(string), meta.EventsErrorStatus, ec.capacityPerTokenOrDestination)
					if err != nil {
						logging.Warnf("failed to trim events cache error events for %s destination: %v", destinationID, err)
					}
					return true
				})

				ec.lastTokensErrors.Range(func(tokenID interface{}, value interface{}) bool {
					ec.lastTokensErrors.Delete(tokenID)
					err := ec.storage.TrimEvents(meta.EventsTokenNamespace, tokenID.(string), meta.EventsErrorStatus, ec.capacityPerTokenOrDestination)
					if err != nil {
						logging.Warnf("failed to trim events cache error events for %s token: %v", tokenID, err)
					}
					return true
				})
			}
		}
	})
}

//RawEvent puts value into channel which will be read and written to storage
func (ec *EventsCache) RawEvent(disabled bool, tokenID string, serializedPayload []byte, skipMsg string) {
	if !disabled && ec.isActive() {
		if !ec.isRateLimiterAllowed(tokenID, meta.EventsPureStatus) {
			return
		}

		select {
		case ec.rawEventsChannel <- &rawEvent{tokenID: tokenID, serializedPayload: serializedPayload, skip: skipMsg, eventMetaStatus: meta.EventsPureStatus}:
		default:
			if rand.Int31n(1000) == 0 {
				logging.Debugf("[events cache] raw events queue overflow. Live Events UI may show inaccurate results. Consider increasing config variable: server.cache.pool.size (current value: %d)", ec.poolSize)
			}
		}
	}
}

//RawErrorEvent puts value into channel which will be read and written to storage
func (ec *EventsCache) RawErrorEvent(disabled bool, tokenID string, serializedMalformedPayload []byte, err error) {
	if !disabled && ec.isActive() {
		//error goes both in general collection and dedicated errors' collection.
		if ec.isRateLimiterAllowed(tokenID, meta.EventsPureStatus) {
			select {
			case ec.rawEventsChannel <- &rawEvent{tokenID: tokenID, serializedMalformedPayload: serializedMalformedPayload, error: err.Error()}:
			default:
				if rand.Int31n(1000) == 0 {
					logging.Debugf("[events cache] raw events queue overflow. Live Events UI may show inaccurate results. Consider increasing config variable: server.cache.pool.size (current value: %d)", ec.poolSize)
				}
			}
		}
		if ec.isRateLimiterAllowed(tokenID, meta.EventsErrorStatus) {
			select {
			case ec.rawEventsChannel <- &rawEvent{tokenID: tokenID, serializedMalformedPayload: serializedMalformedPayload, error: err.Error(), eventMetaStatus: meta.EventsErrorStatus}:
			default:
				if rand.Int31n(1000) == 0 {
					logging.Debugf("[events cache] raw error events queue overflow. Live Events UI may show inaccurate results. Consider increasing config variable: server.cache.pool.size (current value: %d)", ec.poolSize)
				}
			}
		}
	}
}

//Succeed puts value into channel which will be read and updated in storage
func (ec *EventsCache) Succeed(eventContext *adapters.EventContext) {
	if !eventContext.CacheDisabled && ec.isActive() {
		if !ec.isRateLimiterAllowed(eventContext.DestinationID, meta.EventsPureStatus) {
			return
		}

		select {
		case ec.statusEventsChannel <- &statusEvent{successEventContext: eventContext}:
		default:
			if rand.Int31n(1000) == 0 {
				logging.Debugf("[events cache] status events queue overflow. Live Events UI may show inaccurate results. Consider increasing config variable: server.cache.pool.size (current value: %d)", ec.poolSize)
			}
		}
	}
}

//Error puts value into channel which will be read and updated in storage
func (ec *EventsCache) Error(cacheDisabled bool, destinationID, originEvent string, errMsg string) {
	if !cacheDisabled && ec.isActive() {
		//error goes both in general collection and dedicated errors' collection.
		if ec.isRateLimiterAllowed(destinationID, meta.EventsPureStatus) {
			select {
			case ec.statusEventsChannel <- &statusEvent{originEvent: originEvent, destinationID: destinationID, error: errMsg}:
			default:
				if rand.Int31n(1000) == 0 {
					logging.Debugf("[events cache] status events queue overflow. Live Events UI may show inaccurate results. Consider increasing config variable: server.cache.pool.size (current value: %d)", ec.poolSize)
				}
			}
		}

		if ec.isRateLimiterAllowed(destinationID, meta.EventsErrorStatus) {
			select {
			case ec.statusEventsChannel <- &statusEvent{originEvent: originEvent, destinationID: destinationID, error: errMsg, eventMetaStatus: meta.EventsErrorStatus}:
			default:
				if rand.Int31n(1000) == 0 {
					logging.Debugf("[events cache] error status events queue overflow. Live Events UI may show inaccurate results. Consider increasing config variable: server.cache.pool.size (current value: %d)", ec.poolSize)
				}
			}
		}
	}
}

//Skip puts value into channel which will be read and updated in storage
func (ec *EventsCache) Skip(cacheDisabled bool, destinationID, originEvent string, errMsg string) {
	if !cacheDisabled && ec.isActive() {
		if !ec.isRateLimiterAllowed(destinationID, meta.EventsPureStatus) {
			return
		}

		select {
		case ec.statusEventsChannel <- &statusEvent{skip: true, originEvent: originEvent, destinationID: destinationID, error: errMsg}:
		default:
			if rand.Int31n(1000) == 0 {
				logging.Debugf("[events cache] status events queue overflow. Live Events UI may show inaccurate results. Consider increasing config variable: server.cache.pool.size (current value: %d)", ec.poolSize)
			}
		}
	}
}

//saveTokenEvent saves raw JSON event into the storage by token
//and saves to token error collection if error
func (ec *EventsCache) saveTokenEvent(tokenID string, serializedPayload, serializedMalformedPayload []byte, errMsg, skipMsg, eventMetaStatus string) {
	entity := &meta.Event{
		Original:  string(serializedPayload),
		Malformed: string(serializedMalformedPayload),
		TokenID:   tokenID,
		Error:     errMsg,
		Skip:      skipMsg,
		Timestamp: timestamp.NowUTC(),
		UID:       uuid.New(),
	}

	if eventMetaStatus == meta.EventsPureStatus {
		err := ec.storage.AddEvent(meta.EventsTokenNamespace, tokenID, meta.EventsPureStatus, entity)
		if err != nil {
			logging.Errorf("failed to save raw JSON event %v by tokenID %s in meta.storage: %v", string(serializedPayload), tokenID, err)
			return
		}
		ec.lastTokens.LoadOrStore(tokenID, true)
	} else if eventMetaStatus == meta.EventsErrorStatus {
		err := ec.storage.AddEvent(meta.EventsTokenNamespace, tokenID, meta.EventsErrorStatus, entity)
		if err != nil {
			logging.Errorf("failed to save raw JSON event with error %v by tokenID %s in meta.storage: %v", string(serializedPayload), tokenID, err)
			return
		}

		ec.lastTokensErrors.LoadOrStore(tokenID, true)
	}
}

//saveDestinationEventWithStatus saves processed JSON event in the storage by destinationID into processed collection and
//if error into error collection
func (ec *EventsCache) saveDestinationEventWithStatus(entity *meta.Event, metaStatus string) error {
	if metaStatus == meta.EventsPureStatus {
		if err := ec.storage.AddEvent(meta.EventsDestinationNamespace, entity.DestinationID, meta.EventsPureStatus, entity); err != nil {
			return err
		}
		ec.lastDestinations.LoadOrStore(entity.DestinationID, true)
	}

	if metaStatus == meta.EventsErrorStatus {
		if err := ec.storage.AddEvent(meta.EventsDestinationNamespace, entity.DestinationID, meta.EventsErrorStatus, entity); err != nil {
			return err
		}
		ec.lastDestinationsErrors.LoadOrStore(entity.DestinationID, true)
	}

	return nil
}

//createMetaEvent serializes and creates meta.Event entity with success/error/skip status for storage
func (ec *EventsCache) createEventEntity(statusEvent *statusEvent) (*meta.Event, error) {
	if statusEvent.successEventContext == nil {
		if statusEvent.skip {
			// ** Skip Event **
			return &meta.Event{
				Timestamp:     timestamp.NowUTC(),
				Original:      statusEvent.originEvent,
				Skip:          statusEvent.error,
				DestinationID: statusEvent.destinationID,
				Success:       "",
				Error:         "",
				TokenID:       "",
			}, nil
		} else {
			// ** Error Event **
			return &meta.Event{
				Timestamp:     timestamp.NowUTC(),
				Original:      statusEvent.originEvent,
				Error:         statusEvent.error,
				DestinationID: statusEvent.destinationID,
				Success:       "",
				Skip:          "",
				TokenID:       "",
			}, nil
		}
	}

	//** Succeed Event **
	eventContext := statusEvent.successEventContext
	var succeedPayload interface{}

	//proceed HTTP success event
	if eventContext.HTTPRequest != nil {
		succeedPayload = SucceedHTTPEvent{
			DestinationID: eventContext.DestinationID,
			URL:           eventContext.HTTPRequest.URL,
			Method:        eventContext.HTTPRequest.Method,
			Headers:       eventContext.HTTPRequest.Headers,
			Body:          string(eventContext.HTTPRequest.Body),
		}
	} else if eventContext.SynchronousResult != nil {
		body := ""
		bytes, err := json.Marshal([]map[string]interface{}{eventContext.SynchronousResult})
		if err != nil {
			body = fmt.Sprintf("%+v", eventContext.SynchronousResult)
		} else {
			body = string(bytes)
		}
		succeedPayload = SucceedSynchronousEvent{
			DestinationID: eventContext.DestinationID,
			Status:        "ok",
			SdkExtras:     body,
		}
	} else {
		//database success event
		fields := []*adapters.TableField{}
		for name, value := range eventContext.ProcessedEvent {
			sqlType := "unknown"
			//some destinations might not have table (e.g. s3)
			if eventContext.Table != nil {
				if column, ok := eventContext.Table.Columns[name]; ok {
					sqlType = column.Type
				}
			}

			fields = append(fields, &adapters.TableField{
				Field: name,
				Type:  sqlType,
				Value: value,
			})
		}

		var tableName string
		if eventContext.Table != nil {
			tableName = eventContext.Table.Name
		}

		succeedPayload = SucceedDBEvent{
			DestinationID: eventContext.DestinationID,
			Table:         tableName,
			Record:        fields,
		}
	}

	serializedSucceedPayload, err := json.Marshal(succeedPayload)
	if err != nil {
		return nil, fmt.Errorf("failed to serialize processed event [%v]: %v", succeedPayload, err)
	}

	serializedOriginalEvent := eventContext.GetSerializedOriginalEvent()

	return &meta.Event{
		Timestamp:     timestamp.NowUTC(),
		Original:      serializedOriginalEvent,
		Success:       string(serializedSucceedPayload),
		DestinationID: eventContext.DestinationID,
		Error:         "",
		Skip:          "",
		TokenID:       "",
	}, nil
}

//Get returns
// 1. last [token, destination] namespace raw JSON events with limit
// 2. amount of rate limited events
func (ec *EventsCache) Get(namespace, id, status string, limit int) ([]meta.Event, uint64) {
	metaEvents, err := ec.storage.GetEvents(namespace, id, status, limit)
	lastMinuteLimited := ec.getLastMinuteLimited(id, status)
	if err != nil {
		logging.SystemErrorf("Error getting %d cached events for [%s] %s: %v", limit, id, namespace, err)
		return []meta.Event{}, lastMinuteLimited
	}

	return metaEvents, lastMinuteLimited
}

//GetTotal returns total amount of destination events in storage
func (ec *EventsCache) GetTotal(namespace, id, status string) int {
	total, err := ec.storage.GetTotalEvents(namespace, id, status)
	if err != nil {
		logging.SystemErrorf("Error getting total events for [%s] %s: %v", id, namespace, err)
		return 0
	}

	return total
}

//GetCacheCapacityAndIntervalWindow returns cache capacity and window interval seconds
func (ec *EventsCache) GetCacheCapacityAndIntervalWindow() (int, int) {
	return ec.capacityPerTokenOrDestination, int(ec.timeWindow.Seconds())
}

//Close stops all underlying goroutines
func (ec *EventsCache) Close() error {
	if ec.isActive() {
		close(ec.done)
		close(ec.rawEventsChannel)
		close(ec.statusEventsChannel)
	}

	return nil
}

//isActive indicates if the cache is operating
func (ec *EventsCache) isActive() bool {
	select {
	case <-ec.done:
		return false
	default:
		return true
	}
}

func (ec *EventsCache) isRateLimiterAllowed(id, status string) bool {
	rateLimiterIface, _ := ec.rateLimiters.LoadOrStore(getRateLimiterIdentifier(id, status), NewRefillableRateLimiter(uint64(ec.capacityPerTokenOrDestination), ec.timeWindow))
	rateLimiter, _ := rateLimiterIface.(RateLimiter)
	return rateLimiter.Allow()
}

func (ec *EventsCache) getLastMinuteLimited(id, status string) uint64 {
	rateLimiterIface, _ := ec.rateLimiters.LoadOrStore(getRateLimiterIdentifier(id, status), NewRefillableRateLimiter(uint64(ec.capacityPerTokenOrDestination), ec.timeWindow))
	rateLimiter, _ := rateLimiterIface.(RateLimiter)
	return rateLimiter.GetLastMinuteLimited()
}

func getRateLimiterIdentifier(id string, status string) string {
	return fmt.Sprintf("%s_%s", id, status)
}
