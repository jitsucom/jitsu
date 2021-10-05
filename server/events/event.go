package events

import (
	"encoding/json"
	"fmt"
	"github.com/jitsucom/jitsu/server/logging"
	"github.com/jitsucom/jitsu/server/maputils"
)

//Event is a dto for deserialization input events
type Event map[string]interface{}

//FailedEvent is a dto for serialization fallback events
type FailedEvent struct {
	Event   json.RawMessage `json:"event,omitempty"`
	Error   string          `json:"error,omitempty"`
	EventID string          `json:"event_id,omitempty"`
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

//Clone returns copy of event
func (f Event) Clone() Event {
	return maputils.CopyMap(f)
}
