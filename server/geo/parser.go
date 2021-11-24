package geo

import (
	"encoding/json"
	"errors"
	"fmt"
	"github.com/jitsucom/jitsu/server/jsonutils"
	"strings"
)

type Payload struct {
	GeoResolvers map[string]*ResolverConfig `json:"geo_data_resolvers,omitempty"`
}

func parseConfigFromBytes(b []byte) (map[string]*ResolverConfig, error) {
	payload := &Payload{}
	err := json.Unmarshal(b, &payload)
	if err != nil {
		return nil, err
	}

	return payload.GeoResolvers, nil
}

//ParseConfigAsLink works only with MaxMindType
//returns MaxMind URL or error
func ParseConfigAsLink(config *ResolverConfig) (string, error) {
	if config.Type != MaxmindType {
		return "", fmt.Errorf("unsupported geo resolver type: %s", config.Type)
	}
	mc := &MaxMindConfig{}

	if err := jsonutils.UnmarshalConfig(config.Config, mc); err != nil {
		return "", err
	}

	if mc.MaxMindURL == "" {
		return "", errors.New("maxmind_url is required field")
	}

	if !strings.HasPrefix(mc.MaxMindURL, MaxmindPrefix) {
		return MaxmindPrefix + mc.MaxMindURL, nil
	}

	return mc.MaxMindURL, nil
}
