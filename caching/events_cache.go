package caching

import (
	"encoding/json"
	"github.com/jitsucom/eventnative/events"
	"github.com/jitsucom/eventnative/logging"
	"github.com/jitsucom/eventnative/meta"
	"github.com/jitsucom/eventnative/safego"
	"github.com/jitsucom/eventnative/schema"
	"github.com/jitsucom/eventnative/typing"
	"time"
)

type EventsCache struct {
	storage                meta.Storage
	originalCh             chan *originalFact
	succeedCh              chan *succeedFact
	failedCh               chan *failedFact
	capacityPerDestination int

	closed bool
}

//return EventsCache and start goroutine for async operations
func NewEventsCache(storage meta.Storage, capacityPerDestination int) *EventsCache {
	c := &EventsCache{
		storage:                storage,
		originalCh:             make(chan *originalFact, 1000000),
		succeedCh:              make(chan *succeedFact, 1000000),
		failedCh:               make(chan *failedFact, 1000000),
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
			ec.put(cf.destinationId, cf.eventId, cf.eventFact)
		}
	})

	safego.RunWithRestart(func() {
		for {
			if ec.closed {
				break
			}

			cf := <-ec.succeedCh
			ec.succeed(cf.destinationId, cf.eventId, cf.processed, cf.table, cf.types)
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

//PutAsync put value into channel
func (ec *EventsCache) Put(destinationId, eventId string, value events.Fact) {
	select {
	case ec.originalCh <- &originalFact{destinationId: destinationId, eventId: eventId, eventFact: value}:
	default:
	}
}

//SucceedAsync update value into channel
func (ec *EventsCache) Succeed(destinationId, eventId string, processed events.Fact, table *schema.Table, types map[typing.DataType]string) {
	select {
	case ec.succeedCh <- &succeedFact{destinationId: destinationId, eventId: eventId, processed: processed, table: table, types: types}:
	default:
	}
}

//ErrorAsync update value into channel
func (ec *EventsCache) Error(destinationId, eventId string, errMsg string) {
	select {
	case ec.failedCh <- &failedFact{destinationId: destinationId, eventId: eventId, error: errMsg}:
	default:
	}
}

//put create new fact in storage
func (ec *EventsCache) put(destinationId, eventId string, value events.Fact) {
	if eventId == "" {
		logging.SystemErrorf("[EventsCache] Put(): Event id can't be empty. Destination [%s] event %v", destinationId, value)
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
		logging.Infof("Events cache size: [%d] capacity: [%d] elements to delete: [%d]", eventsInCache, ec.capacityPerDestination, toDelete)
		for i := 0; i < toDelete; i++ {
			err := ec.storage.RemoveLastEvent(destinationId)
			if err != nil {
				logging.SystemErrorf("[%s] Error removing event from cache: %v", destinationId, err)
				return
			}
		}
	}
}

//succeed serialize and update processed fact in storage
func (ec *EventsCache) succeed(destinationId, eventId string, processed events.Fact, table *schema.Table, types map[typing.DataType]string) {
	if eventId == "" {
		logging.SystemErrorf("[EventsCache] Succeed(): Event id can't be empty. Destination [%s] event %v", destinationId, processed)
		return
	}

	fields := []*schema.Field{}

	for name, value := range processed {
		column, ok := table.Columns[name]
		if !ok {
			logging.SystemErrorf("Error serializing table [%s] schema: %v object: %s field: %s", table.Name, table.Columns, processed.Serialize(), name)
			return
		}

		dbFieldType, ok := types[column.GetType()]
		if !ok {
			logging.Warnf("Error getting column type [%s] mapping from %v", column.GetType(), types)
			dbFieldType = "UNKNOWN"
		}
		fields = append(fields, &schema.Field{
			Field: name,
			Type:  dbFieldType,
			Value: value,
		})
	}

	sf := SucceedFact{
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

//error write error into fact field in storage
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
