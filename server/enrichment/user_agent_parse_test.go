package enrichment

import (
	"github.com/spf13/viper"
	"testing"

	"github.com/jitsucom/eventnative/server/appconfig"
	"github.com/jitsucom/eventnative/server/jsonutils"
	"github.com/jitsucom/eventnative/server/test"
	"github.com/jitsucom/eventnative/server/useragent"
	"github.com/stretchr/testify/require"
)

func TestUserAgentParse(t *testing.T) {
	viper.Set("server.log.path", "")

	tests := []struct {
		name        string
		source      string
		destination string
		input       map[string]interface{}
		expected    map[string]interface{}
	}{
		{
			"Nil input object",
			"/key1",
			"/key2",
			nil,
			nil,
		},
		{
			"Empty input object",
			"/key1",
			"/key2",
			map[string]interface{}{},
			map[string]interface{}{},
		},
		{
			"Object with wrong format",
			"/ua",
			"/ua_ip",
			map[string]interface{}{"ua": 10},
			map[string]interface{}{"ua": 10},
		},
		{
			"Object with ua but result node wrong format",
			"/ua",
			"/parsed_ua/payload",
			map[string]interface{}{"ua": "mock", "parsed_ua": "abc"},
			map[string]interface{}{"ua": "mock", "parsed_ua": "abc"},
		},
		{
			"Object with ua ok",
			"/ua",
			"/parsed_ua",
			map[string]interface{}{"ua": "mock"},
			map[string]interface{}{"ua": "mock", "parsed_ua": map[string]interface{}{"device_family": "PK", "os_family": "Windows", "os_version": "95", "ua_family": "Chrome", "ua_version": "1.0.0"}},
		},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			appconfig.Init(false)
			appconfig.Instance.UaResolver = useragent.Mock{}

			uaRule, err := NewUserAgentParseRule(jsonutils.NewJsonPath(tt.source), jsonutils.NewJsonPath(tt.destination))
			require.NoError(t, err)

			uaRule.Execute(tt.input)
			test.ObjectsEqual(t, tt.expected, tt.input, "Facts aren't equal")
		})
	}
}
