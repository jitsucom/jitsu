package caching

import (
	"encoding/json"
	"github.com/jitsucom/eventnative/adapters"
	"github.com/jitsucom/eventnative/events"
	"github.com/jitsucom/eventnative/logging"
	"github.com/jitsucom/eventnative/meta"
	"github.com/jitsucom/eventnative/safego"
	"time"
)

type EventsCache struct {
	storage                meta.Storage
	originalCh             chan *originalEvent
	succeedCh              chan *succeedEvent
	failedCh               chan *failedEvent
	capacityPerDestination int

	closed bool
}

//return EventsCache and start goroutine for async operations
func NewEventsCache(storage meta.Storage, capacityPerDestination int) *EventsCache {
	c := &EventsCache{
		storage:                storage,
		originalCh:             make(chan *originalEvent, 1000000),
		succeedCh:              make(chan *succeedEvent, 1000000),
		failedCh:               make(chan *failedEvent, 1000000),
		capacityPerDestination: capacityPerDestination,
	}
	c.start()
	return c
}

//start goroutine for reading from newCh/succeedCh/errorCh and put/update cache (async)
func (ec *EventsCache) start() {
	safego.RunWithRestart(func() {
		for {
			if ec.closed {
				break
			}

			cf := <-ec.originalCh
			ec.put(cf.destinationId, cf.eventId, cf.event)
		}
	})

	safego.RunWithRestart(func() {
		for {
			if ec.closed {
				break
			}

			cf := <-ec.succeedCh
			ec.succeed(cf.destinationId, cf.eventId, cf.processed, cf.table)
		}
	})

	safego.RunWithRestart(func() {
		for {
			if ec.closed {
				break
			}

			cf := <-ec.failedCh
			ec.error(cf.destinationId, cf.eventId, cf.error)
		}
	})
}

//Put put value into channel which will be read and written to storage
func (ec *EventsCache) Put(destinationId, eventId string, value events.Event) {
	select {
	case ec.originalCh <- &originalEvent{destinationId: destinationId, eventId: eventId, event: value}:
	default:
	}
}

//Succeed put value into channel which will be read and updated in storage
func (ec *EventsCache) Succeed(destinationId, eventId string, processed events.Event, table *adapters.Table) {
	select {
	case ec.succeedCh <- &succeedEvent{destinationId: destinationId, eventId: eventId, processed: processed, table: table}:
	default:
	}
}

//Error put value into channel which will be read and updated in storage
func (ec *EventsCache) Error(destinationId, eventId string, errMsg string) {
	select {
	case ec.failedCh <- &failedEvent{destinationId: destinationId, eventId: eventId, error: errMsg}:
	default:
	}
}

//put create new event in storage
func (ec *EventsCache) put(destinationId, eventId string, value events.Event) {
	if eventId == "" {
		logging.SystemErrorf("[EventsCache] Put(): Event id can't be empty. Destination [%s] Event: %s", destinationId, value.Serialize())
		return
	}

	b, err := json.Marshal(value)
	if err != nil {
		logging.SystemErrorf("[%s] Error marshalling event [%v] before caching: %v", destinationId, value, err)
		return
	}

	eventsInCache, err := ec.storage.AddEvent(destinationId, eventId, string(b), time.Now().UTC())
	if err != nil {
		logging.SystemErrorf("[%s] Error saving event %v in cache: %v", destinationId, value.Serialize(), err)
		return
	}

	//delete old if overflow
	if eventsInCache > ec.capacityPerDestination {
		toDelete := eventsInCache - ec.capacityPerDestination
		if toDelete > 2 {
			logging.Infof("[%s] Events cache size: [%d] capacity: [%d] elements to delete: [%d]", destinationId, eventsInCache, ec.capacityPerDestination, toDelete)
		}
		for i := 0; i < toDelete; i++ {
			err := ec.storage.RemoveLastEvent(destinationId)
			if err != nil {
				logging.SystemErrorf("[%s] Error removing event from cache: %v", destinationId, err)
				return
			}
		}
	}
}

//succeed serialize and update processed event in storage
func (ec *EventsCache) succeed(destinationId, eventId string, processed events.Event, table *adapters.Table) {
	if eventId == "" {
		logging.SystemErrorf("[EventsCache] Succeed(): Event id can't be empty. Destination [%s] event %s", destinationId, processed.Serialize())
		return
	}

	fields := []*adapters.TableField{}

	for name, value := range processed {
		var sqlType string
		column, ok := table.Columns[name]
		if !ok {
			sqlType = "unknown"
		} else {
			sqlType = column.SqlType
		}

		fields = append(fields, &adapters.TableField{
			Field: name,
			Type:  sqlType,
			Value: value,
		})
	}

	sf := SucceedEvent{
		DestinationId: destinationId,
		Table:         table.Name,
		Record:        fields,
	}

	b, err := json.Marshal(sf)
	if err != nil {
		logging.SystemErrorf("[%s] Error marshalling succeed event [%v] before update: %v", destinationId, sf, err)
		return
	}

	err = ec.storage.UpdateSucceedEvent(destinationId, eventId, string(b))
	if err != nil {
		logging.SystemErrorf("[%s] Error updating success event %s in cache: %v", destinationId, processed.Serialize(), err)
		return
	}
}

//error write error into event field in storage
func (ec *EventsCache) error(destinationId, eventId string, errMsg string) {
	if eventId == "" {
		logging.SystemErrorf("[EventsCache] Error(): Event id can't be empty. Destination [%s]", destinationId)
		return
	}

	err := ec.storage.UpdateErrorEvent(destinationId, eventId, errMsg)
	if err != nil {
		logging.SystemErrorf("[%s] Error updating error event [%s] in cache: %v", destinationId, eventId, err)
		return
	}
}

//GetN return at most n facts by key
func (ec *EventsCache) GetN(destinationId string, start, end time.Time, n int) []meta.Event {
	facts, err := ec.storage.GetEvents(destinationId, start, end, n)
	if err != nil {
		logging.SystemErrorf("Error getting %d cached events for [%s] destination: %v", n, destinationId, err)
		return []meta.Event{}
	}

	return facts
}

//GetTotal return total amount of destination events in storage
func (ec *EventsCache) GetTotal(destinationId string) int {
	total, err := ec.storage.GetTotalEvents(destinationId)
	if err != nil {
		logging.SystemErrorf("Error getting total events for [%s] destination: %v", destinationId, err)
		return 0
	}

	return total
}

func (ec *EventsCache) Close() error {
	ec.closed = true
	return nil
}
