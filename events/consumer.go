package events

import (
	"encoding/json"
	"fmt"
	"github.com/jitsucom/eventnative/logging"
	"github.com/jitsucom/eventnative/maputils"
	"io"
)

type Fact map[string]interface{}

type FailedFact struct {
	Event   json.RawMessage `json:"event,omitempty"`
	Error   string          `json:"error,omitempty"`
	EventId string          `json:"event_id,omitempty"`
}

type Consumer interface {
	io.Closer
	Consume(fact Fact, tokenId string)
}

func (f Fact) Serialize() string {
	b, err := json.Marshal(f)
	if err != nil {
		logging.Errorf("Error serializing event [%v]: %v", f, err)
		return fmt.Sprintf("%v", f)
	}

	return string(b)
}

func (f Fact) Clone() Fact {
	return maputils.CopyMap(f)
}
