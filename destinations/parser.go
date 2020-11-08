package destinations

import (
	"encoding/json"
	"github.com/google/martian/log"
	"github.com/jitsucom/eventnative/resources"
	"github.com/jitsucom/eventnative/storages"
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

func getHash(name string, destination storages.DestinationConfig) string {
	b, err := json.Marshal(destination)
	if err != nil {
		log.Errorf("Error getting hash(marshalling) from [%s] destination: %v", name, err)
		return ""
	}

	return resources.GetHash(b)
}
