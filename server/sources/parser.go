package sources

import (
	"encoding/json"
	driversbase "github.com/jitsucom/jitsu/server/drivers/base"
)

type Payload struct {
	Sources map[string]driversbase.SourceConfig `json:"sources,omitempty"`
}

func parseFromBytes(b []byte) (map[string]driversbase.SourceConfig, error) {
	payload := &Payload{}
	err := json.Unmarshal(b, &payload)
	if err != nil {
		return nil, err
	}

	return payload.Sources, nil
}
