package adapters

import "github.com/jitsucom/jitsu/server/events"

//InsertContext is used as a dto for insert operation
type InsertContext struct {
	// -- single --
	eventContext *EventContext

	// -- batch --
	objects          []map[string]interface{}
	table            *Table
	deleteConditions *DeleteConditions
}

func NewSingleInsertContext(eventContext *EventContext) *InsertContext {
	return &InsertContext{
		eventContext: eventContext,
	}
}

func NewBatchInsertContext(table *Table, objects []map[string]interface{}, deleteConditions *DeleteConditions) *InsertContext {
	return &InsertContext{
		objects:          objects,
		table:            table,
		deleteConditions: deleteConditions,
	}
}

//EventContext is an extracted serializable event identifiers
//it is used in counters/metrics/cache
type EventContext struct {
	CacheDisabled   bool
	DestinationID   string
	EventID         string
	TokenID         string
	Src             string
	RawEvent        events.Event
	ProcessedEvent  events.Event
	Table           *Table
	RecognizedEvent bool

	SerializedOriginalEvent string

	//HTTPRequest is applicable only for HTTP events
	HTTPRequest       *Request
	SynchronousResult map[string]interface{}
}

func (ec *EventContext) GetSerializedOriginalEvent() string {
	if ec.SerializedOriginalEvent != "" {
		return ec.SerializedOriginalEvent
	}

	if ec.RawEvent != nil {
		return ec.RawEvent.Serialize()
	}

	return ""
}
