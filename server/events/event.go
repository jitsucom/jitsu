package events

import (
	"encoding/json"
	"fmt"
	"net/http"

	"github.com/jitsucom/jitsu/server/logging"
	"github.com/jitsucom/jitsu/server/maputils"
	"github.com/jitsucom/jitsu/server/parsers"
)

const HTTPContextField = "__HTTP_CONTEXT__"

type HTTPContext struct {
	Headers http.Header `json:"headers,omitempty"`
}

//Event is a dto for deserialization input events
type Event map[string]interface{}

//SkippedEvent is a dto for serialization in events cache
type SkippedEvent struct {
	Event           json.RawMessage `json:"event,omitempty"`
	Error           string          `json:"error,omitempty"`
	RecognizedEvent bool
}

//SkippedEvents is a dto for keeping skipped events per src
type SkippedEvents struct {
	Events []*SkippedEvent
}

//IsEmpty return true if nil or events are empty
func (se *SkippedEvents) IsEmpty() bool {
	return se == nil || len(se.Events) == 0
}

//FailedEvent is a dto for serialization fallback events
type FailedEvent struct {
	MalformedEvent  string          `json:"malformed_event,omitempty"`
	Event           json.RawMessage `json:"event,omitempty"`
	Error           string          `json:"error,omitempty"`
	EventID         string          `json:"event_id,omitempty"`
	RecognizedEvent bool
}

//FailedEvents is a dto for keeping fallback events per src
type FailedEvents struct {
	Events []*FailedEvent
	Src    map[string]int
}

//NewFailedEvents returns FailedEvents
func NewFailedEvents() *FailedEvents {
	return &FailedEvents{Src: map[string]int{}}
}

//IsEmpty return true if nil or events are empty
func (ff *FailedEvents) IsEmpty() bool {
	return ff == nil || len(ff.Events) == 0
}

//Serialize returns JSON string representation of the event
func (f Event) Serialize() string {
	b, err := json.Marshal(f)
	if err != nil {
		logging.Errorf("Error serializing event [%v]: %v", f, err)
		return fmt.Sprintf("%v", f)
	}

	return string(b)
}

//DebugString returns the same JSON string representation of the event as Serialize but limited to 1024 bytes
func (f Event) DebugString() string {
	limit := 1024
	str := f.Serialize()
	if len(str) <= limit {
		return str
	}
	return str[:limit]
}

//Clone returns copy of event
func (f Event) Clone() Event {
	return maputils.CopyMap(f)
}

//ParseFallbackJSON returns parsed into map[string]interface{} event from events.FailedFact
func ParseFallbackJSON(line []byte) (map[string]interface{}, error) {
	fe := &FailedEvent{}
	err := parsers.ParseJSONAsObject(line, fe)
	if err != nil {
		return nil, fmt.Errorf("cannot unmarshal bytes into Go value of type FailedEvent {}: %v", err)
	}

	if fe.MalformedEvent != "" {
		return nil, fmt.Errorf("event: %s was sent to fallback because it is malformed (not valid JSON): %s", fe.MalformedEvent, fe.Error)
	}

	if len(fe.Event) == 0 {
		return nil, fmt.Errorf("'event' field can't be empty in fallback object: %s", string(line))
	}

	originalEvent, err := parsers.ParseJSON(fe.Event)
	if err != nil {
		return nil, fmt.Errorf("Error parsing event %s malformed json: %v", string(line), err)
	}

	return originalEvent, nil
}
