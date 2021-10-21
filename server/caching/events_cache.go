package caching

import (
	"encoding/json"
	"github.com/jitsucom/jitsu/server/adapters"
	"github.com/jitsucom/jitsu/server/appconfig"
	"github.com/jitsucom/jitsu/server/events"
	"github.com/jitsucom/jitsu/server/logging"
	"github.com/jitsucom/jitsu/server/meta"
	"github.com/jitsucom/jitsu/server/safego"
	"time"
)

//EventsCache is an event cache based on meta.Storage(Redis)
type EventsCache struct {
	storage                meta.Storage
	originalCh             chan *originalEvent
	succeedCh              chan *succeedEvent
	failedCh               chan *failedEvent
	skippedCh              chan *failedEvent
	capacityPerDestination int

	done chan struct{}
}

//NewEventsCache returns EventsCache and start goroutine for async operations
func NewEventsCache(storage meta.Storage, capacityPerDestination int) *EventsCache {
	c := &EventsCache{
		storage:                storage,
		originalCh:             make(chan *originalEvent),
		succeedCh:              make(chan *succeedEvent),
		failedCh:               make(chan *failedEvent),
		skippedCh:              make(chan *failedEvent),
		capacityPerDestination: capacityPerDestination,

		done: make(chan struct{}),
	}
	c.start()
	return c
}

//start goroutine for reading from newCh/succeedCh/errorCh and put/update cache (async)
func (ec *EventsCache) start() {
	safego.RunWithRestart(func() {
		for cf := range ec.originalCh {
			ec.put(cf.destinationID, cf.eventID, cf.event)
		}
	})

	safego.RunWithRestart(func() {
		for cf := range ec.succeedCh {
			ec.succeed(cf.eventContext)
		}
	})

	safego.RunWithRestart(func() {
		for cf := range ec.failedCh {
			ec.error(cf.destinationID, cf.eventID, cf.error)
		}
	})

	safego.RunWithRestart(func() {
		for cf := range ec.skippedCh {
			ec.skip(cf.destinationID, cf.eventID, cf.error)
		}
	})
}

//Put puts value into channel which will be read and written to storage
func (ec *EventsCache) Put(disabled bool, destinationID, eventID string, value events.Event) {
	if !disabled && ec.isActive() {
		ec.originalCh <- &originalEvent{destinationID: destinationID, eventID: eventID, event: value}
	}
}

//Succeed puts value into channel which will be read and updated in storage
func (ec *EventsCache) Succeed(eventContext *adapters.EventContext) {
	if !eventContext.CacheDisabled && ec.isActive() {
		ec.succeedCh <- &succeedEvent{eventContext: eventContext}
	}
}

//Error puts value into channel which will be read and updated in storage
func (ec *EventsCache) Error(disabled bool, destinationID, eventID string, errMsg string) {
	if !disabled && ec.isActive() {
		ec.failedCh <- &failedEvent{destinationID: destinationID, eventID: eventID, error: errMsg}
	}
}

//Skip puts value into channel which will be read and updated in storage
func (ec *EventsCache) Skip(disabled bool, destinationID, eventID string, errMsg string) {
	if !disabled && ec.isActive() {
		ec.skippedCh <- &failedEvent{destinationID: destinationID, eventID: eventID, error: errMsg}
	}
}

//put creates new event in storage
func (ec *EventsCache) put(destinationID, eventID string, value events.Event) {
	if eventID == "" {
		logging.SystemErrorf("[%s] Event id can't be empty. Event: %s", destinationID, value.Serialize())
		return
	}

	b, err := json.Marshal(value)
	if err != nil {
		logging.SystemErrorf("[%s] Error marshalling event [%v] before caching: %v", destinationID, value, err)
		return
	}

	eventsInCache, err := ec.storage.AddEvent(destinationID, eventID, string(b), time.Now().UTC())
	if err != nil {
		logging.SystemErrorf("[%s] Error saving event %v in cache: %v", destinationID, value.Serialize(), err)
		return
	}

	//delete old if overflow
	if eventsInCache > ec.capacityPerDestination {
		toDelete := eventsInCache - ec.capacityPerDestination
		if toDelete > 2 {
			logging.Infof("[%s] Events cache size: [%d] capacity: [%d] elements to delete: [%d]", destinationID, eventsInCache, ec.capacityPerDestination, toDelete)
		}
		for i := 0; i < toDelete; i++ {
			err := ec.storage.RemoveLastEvent(destinationID)
			if err != nil {
				logging.SystemErrorf("[%s] Error removing event from cache: %v", destinationID, err)
				return
			}
		}
	}
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
		var body map[string]interface{}
		if len(eventContext.HTTPRequest.Body) > 0 {
			body = map[string]interface{}{}
			if err := json.Unmarshal(eventContext.HTTPRequest.Body, &body); err != nil {
				logging.SystemErrorf("[%s] Error unmarshalling succeed HTTP event body: %s: %v", eventContext.DestinationID, string(eventContext.HTTPRequest.Body), err)
			}
		}
		eventEntity = SucceedHTTPEvent{
			DestinationID: eventContext.DestinationID,
			URL:           eventContext.HTTPRequest.URL,
			Method:        eventContext.HTTPRequest.Method,
			Headers:       eventContext.HTTPRequest.Headers,
			Body:          body,
		}
	} else {
		//database success event
		fields := []*adapters.TableField{}
		for name, value := range eventContext.ProcessedEvent {
			sqlType := "unknown"
			//some destinations might not have table (e.g. s3)
			if eventContext.Table != nil {
				if column, ok := eventContext.Table.Columns[name]; ok {
					sqlType = column.SQLType
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
	close(ec.done)
	close(ec.originalCh)
	close(ec.succeedCh)
	close(ec.failedCh)
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
