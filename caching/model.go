package caching

import (
	"github.com/jitsucom/eventnative/events"
	"github.com/jitsucom/eventnative/schema"
	"github.com/jitsucom/eventnative/typing"
)

//entity
type SucceedFact struct {
	DestinationId string          `json:"destination_id,omitempty"`
	Table         string          `json:"table,omitempty"`
	Record        []*schema.Field `json:"record,omitempty"`
}

//channel dto
type originalFact struct {
	destinationId string
	eventId       string
	eventFact     events.Fact
}

//channel dto
type succeedFact struct {
	destinationId string
	eventId       string

	table     *schema.Table
	processed events.Fact
	types     map[typing.DataType]string
}

//channel dto
type failedFact struct {
	destinationId string
	eventId       string

	error string
}
