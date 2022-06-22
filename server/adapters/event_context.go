package adapters

import (
	"github.com/jitsucom/jitsu/server/drivers/base"
	"github.com/jitsucom/jitsu/server/events"
)

//InsertContext is used as a dto for insert operation
type InsertContext struct {
	// -- for http single request --
	eventContext *EventContext

	// -- batch --
	objects          []map[string]interface{}
	table            *Table
	deleteConditions *base.DeleteConditions
	merge            bool
}

func NewSingleInsertContext(eventContext *EventContext) *InsertContext {
	return &InsertContext{
		eventContext: eventContext,
		table:        eventContext.Table,
		objects:      []map[string]interface{}{eventContext.ProcessedEvent},
	}
}

func NewBatchInsertContext(table *Table, objects []map[string]interface{}, merge bool, deleteConditions *base.DeleteConditions) *InsertContext {
	return &InsertContext{
		objects:          objects,
		table:            table,
		deleteConditions: deleteConditions,
		merge:            merge,
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
