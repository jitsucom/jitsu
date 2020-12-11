package caching

import (
	"github.com/jitsucom/eventnative/adapters"
	"github.com/jitsucom/eventnative/events"
)

//entity
type SucceedEvent struct {
	DestinationId string                 `json:"destination_id,omitempty"`
	Table         string                 `json:"table,omitempty"`
	Record        []*adapters.TableField `json:"record,omitempty"`
}

//channel dto
type originalEvent struct {
	destinationId string
	eventId       string
	event         events.Event
}

//channel dto
type succeedEvent struct {
	destinationId string
	eventId       string

	table     *adapters.Table
	processed events.Event
}

//channel dto
type failedEvent struct {
	destinationId string
	eventId       string

	error string
}
