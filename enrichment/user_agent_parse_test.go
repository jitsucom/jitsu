package enrichment

import (
	"github.com/jitsucom/eventnative/appconfig"
	"github.com/jitsucom/eventnative/jsonutils"
	"github.com/jitsucom/eventnative/test"
	"github.com/jitsucom/eventnative/useragent"
	"github.com/stretchr/testify/require"
	"testing"
)

func TestUserAgentParse(t *testing.T) {
	tests := []struct {
		name          string
		source        string
		destination   string
		convertResult bool
		input         map[string]interface{}
		expected      map[string]interface{}
		expectedErr   string
	}{
		{
			"Nil input object",
			"/key1",
			"/key2",
			false,
			nil,
			nil,
			"",
		},
		{
			"Empty input object",
			"/key1",
			"/key2",
			false,
			map[string]interface{}{},
			map[string]interface{}{},
			"",
		},
		{
			"Object with wrong format",
			"/ua",
			"/ua_ip",
			false,
			map[string]interface{}{"ua": 10},
			map[string]interface{}{"ua": 10},
			"",
		},
		{
			"Object with ua but result node wrong format",
			"/ua",
			"/parsed_ua/payload",
			false,
			map[string]interface{}{"ua": "mock", "parsed_ua": "abc"},
			map[string]interface{}{"ua": "mock", "parsed_ua": "abc"},
			"",
		},
		{
			"Object with ua ok",
			"/ua",
			"/parsed_ua",
			false,
			map[string]interface{}{"ua": "mock"},
			map[string]interface{}{"ua": "mock", "parsed_ua": useragent.MockData},
			"",
		},
		{
			"Object with ua ok and convert result",
			"/ua",
			"/parsed_ua",
			true,
			map[string]interface{}{"ua": "mock"},
			map[string]interface{}{"ua": "mock", "parsed_ua": map[string]interface{}{"device_family": "PK", "os_family": "Windows", "os_version": "95", "ua_family": "Chrome", "ua_version": "1.0.0"}},
			"",
		},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			appconfig.Init()
			appconfig.Instance.UaResolver = useragent.Mock{}

			uaRule, err := NewUserAgentParseRule(jsonutils.NewJsonPath(tt.source), jsonutils.NewJsonPath(tt.destination), tt.convertResult)
			require.NoError(t, err)

			err = uaRule.Execute(tt.input)
			if tt.expectedErr != "" {
				require.Error(t, err)
				require.Equal(t, tt.expectedErr, err.Error())
			} else {
				test.ObjectsEqual(t, tt.expected, tt.input, "Facts aren't equal")
			}
		})
	}
}
