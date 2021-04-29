package sources

import (
	"encoding/json"
	"github.com/jitsucom/jitsu/server/drivers"
)

type Payload struct {
	Sources map[string]drivers.SourceConfig `json:"sources,omitempty"`
}

func parseFromBytes(b []byte) (map[string]drivers.SourceConfig, error) {
	payload := &Payload{}
	err := json.Unmarshal(b, &payload)
	if err != nil {
		return nil, err
	}

	return payload.Sources, nil
}
