package caching

import (
	"github.com/jitsucom/jitsu/server/adapters"
	"github.com/jitsucom/jitsu/server/events"
)

//SucceedDBEvent is an entity for cached events response for databases events
type SucceedDBEvent struct {
	DestinationID string                 `json:"destination_id,omitempty"`
	Table         string                 `json:"table,omitempty"`
	Record        []*adapters.TableField `json:"record,omitempty"`
}

//SucceedHTTPEvent is an entity for cached events response for HTTP events
type SucceedHTTPEvent struct {
	DestinationID string `json:"destination_id,omitempty"`

	URL     string            `json:"url,omitempty"`
	Method  string            `json:"method,omitempty"`
	Headers map[string]string `json:"headers,omitempty"`
	Body    string            `json:"body,omitempty"`
}

//channel dto
type statusEvent struct {
	eventType     string
	destinationID string
	eventID       string
	event         events.Event
	eventContext  *adapters.EventContext
	error         string
}
