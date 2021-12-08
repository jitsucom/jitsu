package destinations

import (
	"encoding/json"
	"github.com/jitsucom/jitsu/server/config"
)

type Payload struct {
	Destinations map[string]config.DestinationConfig `json:"destinations,omitempty"`
}

func parseFromBytes(b []byte) (map[string]config.DestinationConfig, error) {
	payload := &Payload{}
	err := json.Unmarshal(b, &payload)
	if err != nil {
		return nil, err
	}

	return payload.Destinations, nil
}
