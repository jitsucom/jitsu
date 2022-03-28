package caching

import (
	"github.com/jitsucom/jitsu/server/adapters"
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

type SucceedSynchronousEvent struct {
	DestinationID string `json:"destination_id,omitempty"`
	Status        string `json:"status,omitempty"`
	SdkExtras     string `json:"jitsu_sdk_extras,omitempty"`
}

//channel dto
type rawEvent struct {
	tokenID                    string
	serializedPayload          []byte
	serializedMalformedPayload []byte
	error                      string
	skip                       string

	eventMetaStatus string
}

//channel dto
type statusEvent struct {
	destinationID string
	originEvent   string
	error         string
	skip          bool

	eventMetaStatus string

	successEventContext *adapters.EventContext
}
