package destinations

import (
	"encoding/json"

	"github.com/jitsucom/jitsu/server/storages"
)

type Payload struct {
	Destinations map[string]storages.DestinationConfig `json:"destinations,omitempty"`
}

func parseFromBytes(b []byte) (map[string]storages.DestinationConfig, error) {
	payload := &Payload{}
	err := json.Unmarshal(b, &payload)
	if err != nil {
		return nil, err
	}

	return payload.Destinations, nil
}
