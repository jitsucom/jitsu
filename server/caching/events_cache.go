package caching

import (
	"encoding/json"
	"github.com/jitsucom/jitsu/server/adapters"
	"github.com/jitsucom/jitsu/server/appconfig"
	"github.com/jitsucom/jitsu/server/logging"
	"github.com/jitsucom/jitsu/server/meta"
	"github.com/jitsucom/jitsu/server/safego"
	"github.com/jitsucom/jitsu/server/timestamp"
	"math/rand"
	"sync"
	"time"
)

//EventsCache is an event cache based on meta.Storage(Redis)
type EventsCache struct {
	storage                meta.Storage
	eventsChannel          chan *statusEvent
	capacityPerDestination int
	poolSize               int
	trimIntervalMs         time.Duration
	lastDestinations       sync.Map
	done                   chan struct{}
}

//NewEventsCache returns EventsCache and start goroutine for async operations
func NewEventsCache(enabled bool, storage meta.Storage, capacityPerDestination, poolSize, trimIntervalMs int) *EventsCache {
	if !enabled {
		logging.Warnf("Events cache is disabled.")
		done := make(chan struct{})
		close(done)
		//return closed
		return &EventsCache{done: done}
	}

	if storage.Type() == meta.DummyType {
		logging.Warnf("Events cache is disabled. Since 'meta.storage' configuration is required.")

		done := make(chan struct{})
		close(done)
		//return closed
		return &EventsCache{done: done}
	}

	c := &EventsCache{
		storage:                storage,
		eventsChannel:          make(chan *statusEvent, capacityPerDestination*10),
		capacityPerDestination: capacityPerDestination,
		lastDestinations:       sync.Map{},
		poolSize:               poolSize,
		trimIntervalMs:         time.Duration(trimIntervalMs),

		done: make(chan struct{}),
	}

	for i := 0; i < poolSize; i++ {
		c.start()
	}
	c.startTrimmer()
	return c
}

//start goroutine for reading from newCh/succeedCh/errorCh and put/update cache (async)
func (ec *EventsCache) start() {
	safego.RunWithRestart(func() {
		for cf := range ec.eventsChannel {
			switch cf.eventType {
			case "put":
				ec.put(cf.destinationID, cf.eventID, cf.serializedPayload)
			case "succeed":
				ec.succeed(cf.eventContext)
			case "error":
				ec.error(cf.destinationID, cf.eventID, cf.error)
			case "skip":
				ec.skip(cf.destinationID, cf.eventID, cf.error)
			}
		}
	})
}

//start goroutine for reading from newCh/succeedCh/errorCh and put/update cache (async)
func (ec *EventsCache) startTrimmer() {
	safego.RunWithRestart(func() {
		ticker := time.NewTicker(time.Millisecond * ec.trimIntervalMs)
		for {
			select {
			case <-ec.done:
				return
			case <-ticker.C:
				ec.lastDestinations.Range(func(key interface{}, value interface{}) bool {
					ec.lastDestinations.Delete(key)
					err := ec.storage.TrimEvents(key.(string), ec.capacityPerDestination)
					if err != nil {
						logging.Warnf("failed to trim events cache events for %s: %v", key, err)
					}
					return true
				})
			}
		}
	})
}

//Put puts value into channel which will be read and written to storage
func (ec *EventsCache) Put(disabled bool, destinationID, eventID string, serializedPayload []byte) {
	if !disabled && ec.isActive() {
		select {
		case ec.eventsChannel <- &statusEvent{eventType: "put", destinationID: destinationID, eventID: eventID, serializedPayload: serializedPayload}:
		default:
			if rand.Int31n(1000) == 0 {
				logging.Warnf("[events cache] queue overflow. Live Events UI may show inaccurate results. Consider increasing config variable: server.cache.pool.size (current value: %d)", ec.poolSize)
			}
		}
	}
}

//Succeed puts value into channel which will be read and updated in storage
func (ec *EventsCache) Succeed(eventContext *adapters.EventContext) {
	if !eventContext.CacheDisabled && ec.isActive() {
		select {
		case ec.eventsChannel <- &statusEvent{eventType: "succeed", eventContext: eventContext}:
		default:
			if rand.Int31n(1000) == 0 {
				logging.Warnf("[events cache] queue overflow. Live Events UI may show inaccurate results. Consider increasing config variable: server.cache.pool.size (current value: %d)", ec.poolSize)
			}
		}
	}
}

//Error puts value into channel which will be read and updated in storage
func (ec *EventsCache) Error(disabled bool, destinationID, eventID string, errMsg string) {
	if !disabled && ec.isActive() {
		select {
		case ec.eventsChannel <- &statusEvent{eventType: "error", destinationID: destinationID, eventID: eventID, error: errMsg}:
		default:
			if rand.Int31n(1000) == 0 {
				logging.Warnf("[events cache] queue overflow. Live Events UI may show inaccurate results. Consider increasing config variable: server.cache.pool.size (current value: %d)", ec.poolSize)
			}
		}
	}
}

//Skip puts value into channel which will be read and updated in storage
func (ec *EventsCache) Skip(disabled bool, destinationID, eventID string, errMsg string) {
	if !disabled && ec.isActive() {
		select {
		case ec.eventsChannel <- &statusEvent{eventType: "skip", destinationID: destinationID, eventID: eventID, error: errMsg}:
		default:
			if rand.Int31n(1000) == 0 {
				logging.Warnf("[events cache] queue overflow. Live Events UI may show inaccurate results. Consider increasing config variable: server.cache.pool.size (current value: %d)", ec.poolSize)
			}
		}
	}
}

//put creates new event in storage
func (ec *EventsCache) put(destinationID, eventID string, serializedPayload []byte) {
	if eventID == "" {
		logging.SystemErrorf("[%s] Event id can't be empty. Event: %s", destinationID, string(serializedPayload))
		return
	}

	err := ec.storage.AddEvent(destinationID, eventID, string(serializedPayload), timestamp.Now().UTC())
	if err != nil {
		logging.SystemErrorf("[%s] Error saving event %v in cache: %v", destinationID, string(serializedPayload), err)
		return
	}
	ec.lastDestinations.LoadOrStore(destinationID, true)
}

//succeed serializes and update processed event in storage
func (ec *EventsCache) succeed(eventContext *adapters.EventContext) {
	if eventContext.EventID == "" {
		logging.SystemErrorf("[EventsCache] Succeed(): Event id can't be empty. Destination [%s] event %s", eventContext.DestinationID, eventContext.ProcessedEvent.Serialize())
		return
	}
	eventId := eventContext.EventID
	if processedEventId := appconfig.Instance.GlobalUniqueIDField.Extract(eventContext.ProcessedEvent); processedEventId != "" {
		eventId = processedEventId
	}

	var eventEntity interface{}

	//proceed HTTP success event
	if eventContext.HTTPRequest != nil {
		eventEntity = SucceedHTTPEvent{
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

		eventEntity = SucceedDBEvent{
			DestinationID: eventContext.DestinationID,
			Table:         tableName,
			Record:        fields,
		}
	}

	b, err := json.Marshal(eventEntity)
	if err != nil {
		logging.SystemErrorf("[%s] Error marshalling succeed event [%v] before update: %v", eventContext.DestinationID, eventEntity, err)
		return
	}

	err = ec.storage.UpdateSucceedEvent(eventContext.DestinationID, eventId, string(b))
	if err != nil {
		logging.SystemErrorf("[%s] Error updating success event %s in cache: %v", eventContext.DestinationID, eventContext.ProcessedEvent.Serialize(), err)
		return
	}
}

//error writes error into event field in storage
func (ec *EventsCache) error(destinationID, eventID string, errMsg string) {
	if eventID == "" {
		logging.SystemErrorf("[EventsCache] Error(): Event id can't be empty. Destination [%s]", destinationID)
		return
	}

	err := ec.storage.UpdateErrorEvent(destinationID, eventID, errMsg)
	if err != nil {
		logging.SystemErrorf("[%s] Error updating error event [%s] in cache: %v", destinationID, eventID, err)
		return
	}
}

//skip writes skipped error into event skip field in storage
func (ec *EventsCache) skip(destinationID, eventID string, errMsg string) {
	if eventID == "" {
		logging.SystemErrorf("[EventsCache] Skip(): Event id can't be empty. Destination [%s]", destinationID)
		return
	}

	err := ec.storage.UpdateSkipEvent(destinationID, eventID, errMsg)
	if err != nil {
		logging.SystemErrorf("[%s] Error updating skipped event [%s] in cache: %v", destinationID, eventID, err)
		return
	}
}

//GetN returns at most n facts by key
func (ec *EventsCache) GetN(destinationID string, start, end time.Time, n int) []meta.Event {
	facts, err := ec.storage.GetEvents(destinationID, start, end, n)
	if err != nil {
		logging.SystemErrorf("Error getting %d cached events for [%s] destination: %v", n, destinationID, err)
		return []meta.Event{}
	}

	return facts
}

//GetTotal returns total amount of destination events in storage
func (ec *EventsCache) GetTotal(destinationID string) int {
	total, err := ec.storage.GetTotalEvents(destinationID)
	if err != nil {
		logging.SystemErrorf("Error getting total events for [%s] destination: %v", destinationID, err)
		return 0
	}

	return total
}

//Close stops all underlying goroutines
func (ec *EventsCache) Close() error {
	if ec.isActive() {
		close(ec.done)
		close(ec.eventsChannel)
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
