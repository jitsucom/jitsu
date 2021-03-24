package events

import (
	"encoding/json"
	"fmt"
	"github.com/jitsucom/jitsu/server/logging"
	"github.com/jitsucom/jitsu/server/maputils"
)

type Event map[string]interface{}

type FailedEvent struct {
	Event   json.RawMessage `json:"event,omitempty"`
	Error   string          `json:"error,omitempty"`
	EventID string          `json:"event_id,omitempty"`
}

func (f Event) Serialize() string {
	b, err := json.Marshal(f)
	if err != nil {
		logging.Errorf("Error serializing event [%v]: %v", f, err)
		return fmt.Sprintf("%v", f)
	}

	return string(b)
}

func (f Event) Clone() Event {
	return maputils.CopyMap(f)
}
