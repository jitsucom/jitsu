package enrichment

import (
	"encoding/json"
	"github.com/jitsucom/eventnative/appconfig"
	"github.com/jitsucom/eventnative/geo"
	"github.com/jitsucom/eventnative/jsonutils"
	"github.com/jitsucom/eventnative/test"
	"github.com/stretchr/testify/require"
	"testing"
)

func TestIpLookup(t *testing.T) {
	geoDataMock := &geo.Data{
		Country: "US",
		City:    "New York",
		Lat:     79.00,
		Lon:     22.00,
		Zip:     "14101",
		Region:  "",
	}
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
			"Object with string instead of ip",
			"/ip",
			"/parsed_ip",
			false,
			map[string]interface{}{"ip": "abc"},
			map[string]interface{}{"ip": "abc"},
			"",
		},
		{
			"Object with wrong format",
			"/ip",
			"/parsed_ip",
			false,
			map[string]interface{}{"ip": 10},
			map[string]interface{}{"ip": 10},
			"",
		},
		{
			"Object with unknown ip",
			"/ip",
			"/parsed_ip",
			false,
			map[string]interface{}{"ip": "20.20.20.20"},
			map[string]interface{}{"ip": "20.20.20.20"},
			"",
		},
		{
			"Object with ip but result node wrong format",
			"/ip",
			"/parsed_ip/payload",
			false,
			map[string]interface{}{"ip": "10.10.10.10", "parsed_ip": "abc"},
			map[string]interface{}{"ip": "10.10.10.10", "parsed_ip": "abc"},
			"",
		},
		{
			"Object with ip ok",
			"/ip",
			"/parsed_ip",
			false,
			map[string]interface{}{"ip": "10.10.10.10"},
			map[string]interface{}{"ip": "10.10.10.10", "parsed_ip": geoDataMock},
			"",
		},
		{
			"Object with ip ok and convert result",
			"/ip",
			"/parsed_ip",
			true,
			map[string]interface{}{"ip": "10.10.10.10"},
			map[string]interface{}{"ip": "10.10.10.10", "parsed_ip": map[string]interface{}{"city": "New York", "country": "US", "latitude": json.Number("79"), "longitude": json.Number("22"), "zip": "14101"}},
			"",
		},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			appconfig.Init()
			appconfig.Instance.GeoResolver = geo.Mock{"10.10.10.10": geoDataMock}

			ipRule, err := NewIpLookupRule(jsonutils.NewJsonPath(tt.source), jsonutils.NewJsonPath(tt.destination), tt.convertResult)
			require.NoError(t, err)

			err = ipRule.Execute(tt.input)
			if tt.expectedErr != "" {
				require.Error(t, err)
				require.Equal(t, tt.expectedErr, err.Error())
			} else {
				test.ObjectsEqual(t, tt.expected, tt.input, "Facts aren't equal")
			}
		})
	}
}
