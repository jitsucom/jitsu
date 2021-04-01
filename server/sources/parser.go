package sources

import (
	"encoding/json"
	"github.com/google/martian/log"
	"github.com/jitsucom/jitsu/server/drivers"
	"github.com/jitsucom/jitsu/server/resources"
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

func getHash(ID string, source drivers.SourceConfig) string {
	b, err := json.Marshal(source)
	if err != nil {
		log.Errorf("Error getting hash(marshalling) from [%s] source: %v", ID, err)
		return ""
	}

	return resources.GetBytesHash(b)
}
