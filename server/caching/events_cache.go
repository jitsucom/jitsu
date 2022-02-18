package caching

import (
	"encoding/json"
	"fmt"
	"github.com/jitsucom/jitsu/server/adapters"
	"github.com/jitsucom/jitsu/server/logging"
	"github.com/jitsucom/jitsu/server/meta"
	"github.com/jitsucom/jitsu/server/safego"
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
	timeWindowSeconds             time.Duration
	trimIntervalMs                time.Duration
	rateLimiters                  sync.Map
	lastDestinations              sync.Map
	lastTokens                    sync.Map

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
		rateLimiters:                  sync.Map{},
		poolSize:                      poolSize,
		timeWindowSeconds:             time.Second * time.Duration(timeWindowSeconds),
		trimIntervalMs:                time.Duration(trimIntervalMs),

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
			ec.putRawEvent(cf.tokenID, cf.serializedPayload)
		}
	})

	safego.RunWithRestart(func() {
		for cf := range ec.statusEventsChannel {
			eventEntity, err := ec.createEventEntity(cf)
			if err != nil {
				logging.SystemErrorf("[%s] failed to create meta event entity [%v] before saving in the cache: %v", cf.successEventContext.DestinationID, cf, err)
				continue
			}

			if err := ec.putEventWithStatus(cf.destinationID, eventEntity); err != nil {
				logging.SystemErrorf("[%s] failed to save meta event entity [%v] into the cache: %v", cf.successEventContext.DestinationID, cf, err)
				continue
			}
		}
	})
}

//start goroutine for trimming events cache by deleting old cached events
func (ec *EventsCache) startTrimmer() {
	safego.RunWithRestart(func() {
		ticker := time.NewTicker(time.Millisecond * ec.trimIntervalMs)
		for {
			select {
			case <-ec.done:
				return
			case <-ticker.C:
				ec.lastDestinations.Range(func(destinationID interface{}, value interface{}) bool {
					ec.lastDestinations.Delete(destinationID)
					err := ec.storage.TrimEvents(meta.EventsDestinationNamespace, destinationID.(string), ec.capacityPerTokenOrDestination)
					if err != nil {
						logging.Warnf("failed to trim events cache events for %s destination: %v", destinationID, err)
					}
					return true
				})

				ec.lastTokens.Range(func(tokenID interface{}, value interface{}) bool {
					ec.lastTokens.Delete(tokenID)
					err := ec.storage.TrimEvents(meta.EventsTokenNamespace, tokenID.(string), ec.capacityPerTokenOrDestination)
					if err != nil {
						logging.Warnf("failed to trim events cache events for %s token: %v", tokenID, err)
					}
					return true
				})
			}
		}
	})
}

//RawEvent puts value into channel which will be read and written to storage
func (ec *EventsCache) RawEvent(disabled bool, tokenID string, serializedPayload []byte) {
	if !disabled && ec.isActive() {
		if !ec.isRateLimiterAllowed(tokenID) {
			return
		}

		select {
		case ec.rawEventsChannel <- &rawEvent{tokenID: tokenID, serializedPayload: serializedPayload}:
		default:
			if rand.Int31n(1000) == 0 {
				logging.Debugf("[events cache] raw events queue overflow. Live Events UI may show inaccurate results. Consider increasing config variable: server.cache.pool.size (current value: %d)", ec.poolSize)
			}
		}
	}
}

//Succeed puts value into channel which will be read and updated in storage
func (ec *EventsCache) Succeed(eventContext *adapters.EventContext) {
	if !eventContext.CacheDisabled && ec.isActive() {
		if !ec.isRateLimiterAllowed(eventContext.DestinationID) {
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
		if !ec.isRateLimiterAllowed(destinationID) {
			return
		}

		select {
		case ec.statusEventsChannel <- &statusEvent{originEvent: originEvent, destinationID: destinationID, error: errMsg}:
		default:
			if rand.Int31n(1000) == 0 {
				logging.Debugf("[events cache] queue overflow. Live Events UI may show inaccurate results. Consider increasing config variable: server.cache.pool.size (current value: %d)", ec.poolSize)
			}
		}
	}
}

//Skip puts value into channel which will be read and updated in storage
func (ec *EventsCache) Skip(cacheDisabled bool, destinationID, originEvent string, errMsg string) {
	if !cacheDisabled && ec.isActive() {
		if !ec.isRateLimiterAllowed(destinationID) {
			return
		}

		select {
		case ec.statusEventsChannel <- &statusEvent{skip: true, originEvent: originEvent, destinationID: destinationID, error: errMsg}:
		default:
			if rand.Int31n(1000) == 0 {
				logging.Debugf("[events cache] queue overflow. Live Events UI may show inaccurate results. Consider increasing config variable: server.cache.pool.size (current value: %d)", ec.poolSize)
			}
		}
	}
}

//putRawEvent saves raw JSON event into the storage by token
func (ec *EventsCache) putRawEvent(tokenID string, serializedPayload []byte) {
	entity := &meta.Event{Original: string(serializedPayload), TokenID: tokenID}
	err := ec.storage.AddEvent(meta.EventsTokenNamespace, tokenID, entity)
	if err != nil {
		logging.SystemErrorf("failed to save raw JSON event %v by tokenID %s in meta.storage: %v", string(serializedPayload), tokenID, err)
		return
	}
	ec.lastTokens.LoadOrStore(tokenID, true)
}

//putEventWithStatus saves processed JSON event with status into the storage by destinationID
func (ec *EventsCache) putEventWithStatus(destinationID string, entity *meta.Event) error {
	if err := ec.storage.AddEvent(meta.EventsDestinationNamespace, destinationID, entity); err != nil {
		return err
	}

	ec.lastDestinations.LoadOrStore(destinationID, true)
	return nil
}

//createMetaEvent serializes and creates meta.Event entity with success/error/skip status for storage
func (ec *EventsCache) createEventEntity(statusEvent *statusEvent) (*meta.Event, error) {
	if statusEvent.successEventContext == nil {
		if statusEvent.skip {
			// ** Skip Event **
			return &meta.Event{
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

	serializedOriginalEvent := eventContext.SerializedOriginalEvent
	if serializedOriginalEvent == "" {
		serializedOriginalEvent = eventContext.RawEvent.Serialize()
	}
	return &meta.Event{
		Original:      serializedOriginalEvent,
		Success:       string(serializedSucceedPayload),
		DestinationID: eventContext.DestinationID,
		Error:         "",
		Skip:          "",
		TokenID:       "",
	}, nil
}

//GetByNamespaceAndID returns
// 1. last [token, destination] namespace raw JSON events with limit
// 2. amount of rate limited events
func (ec *EventsCache) GetByNamespaceAndID(namespace, id string, limit int) ([]meta.Event, uint64) {
	metaEvents, err := ec.storage.GetEvents(namespace, id, limit)
	lastMinuteLimited := ec.getLastMinuteLimited(id)
	if err != nil {
		logging.SystemErrorf("Error getting %d cached events for [%s] %s: %v", limit, id, namespace, err)
		return []meta.Event{}, lastMinuteLimited
	}

	return metaEvents, lastMinuteLimited
}

//GetTotal returns total amount of destination events in storage
func (ec *EventsCache) GetTotal(namespace, id string) int {
	total, err := ec.storage.GetTotalEvents(namespace, id)
	if err != nil {
		logging.SystemErrorf("Error getting total events for [%s] %s: %v", id, namespace, err)
		return 0
	}

	return total
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

func (ec *EventsCache) isRateLimiterAllowed(id string) bool {
	rateLimiterIface, _ := ec.rateLimiters.LoadOrStore(id, NewRateLimiter(uint64(ec.capacityPerTokenOrDestination), ec.timeWindowSeconds))
	rateLimiter, _ := rateLimiterIface.(RateLimiter)
	return rateLimiter.Allow()
}

func (ec *EventsCache) getLastMinuteLimited(id string) uint64 {
	rateLimiterIface, _ := ec.rateLimiters.LoadOrStore(id, NewRateLimiter(uint64(ec.capacityPerTokenOrDestination), ec.timeWindowSeconds))
	rateLimiter, _ := rateLimiterIface.(RateLimiter)
	return rateLimiter.GetLastMinuteLimited()
}
