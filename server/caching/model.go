package caching

import (
	"github.com/jitsucom/jitsu/server/adapters"
	"github.com/jitsucom/jitsu/server/events"
)

//entity
type SucceedEvent struct {
	DestinationID string                 `json:"destination_id,omitempty"`
	Table         string                 `json:"table,omitempty"`
	Record        []*adapters.TableField `json:"record,omitempty"`
}

//channel dto
type originalEvent struct {
	destinationID string
	eventID       string
	event         events.Event
}

//channel dto
type succeedEvent struct {
	destinationID string
	eventID       string

	table     *adapters.Table
	processed events.Event
}

//channel dto
type failedEvent struct {
	destinationID string
	eventID       string

	error string
}
