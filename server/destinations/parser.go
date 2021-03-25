package destinations

import (
	"encoding/json"

	"github.com/google/martian/log"
	"github.com/jitsucom/jitsu/server/storages"
	"github.com/mitchellh/hashstructure/v2"
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

func getHash(name string, hashOpts *hashstructure.HashOptions, destination storages.DestinationConfig) uint64 {
	hash, err := hashstructure.Hash(destination, hashstructure.FormatV2, hashOpts)
	if err != nil {
		log.Errorf("Error getting hash from [%s] destination: %v", name, err)
		return 0
	}

	return hash
}
