package enrichment

import (
	"testing"

	"github.com/jitsucom/jitsu/server/appconfig"
	"github.com/jitsucom/jitsu/server/geo"
	"github.com/jitsucom/jitsu/server/timestamp"
	"github.com/jitsucom/jitsu/server/uuid"
	"github.com/spf13/viper"
	"github.com/stretchr/testify/require"
)

func TestDefault(t *testing.T) {
	SetTestDefaultParams()
	uuid.InitMock()
	timestamp.FreezeTime()
	defer timestamp.UnfreezeTime()

	geoDataMock := &geo.Data{
		Country: "US",
		City:    "New York",
		Lat:     79.00,
		Lon:     22.00,
		Zip:     "14101",
		Region:  "",
	}

	require.NoError(t, appconfig.Init(false, ""))
	defer appconfig.Instance.Close()
	defer appconfig.Instance.CloseEventsConsumers()

	geoService := geo.NewTestService(geo.Mock{"10.10.10.10": geoDataMock})

	InitDefault(
		viper.GetString("server.fields_configuration.src_source_ip"),
		viper.GetString("server.fields_configuration.dst_source_ip"),
		viper.GetString("server.fields_configuration.src_ua"),
		viper.GetString("server.fields_configuration.dst_ua"),
	)

	tests := []struct {
		name     string
		input    map[string]interface{}
		expected map[string]interface{}
	}{
		{
			"Empty input object",
			map[string]interface{}{},
			map[string]interface{}{},
		},
		{
			"Process 1.0 ok",
			map[string]interface{}{
				"source_ip": "10.10.10.10",
				"eventn_ctx": map[string]interface{}{
					"user_agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_5) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/83.0.4103.116 Safari/537.36",
				},
				"key2": "10",
			},
			map[string]interface{}{
				"eventn_ctx": map[string]interface{}{
					"location": map[string]interface{}{
						"city":      "New York",
						"country":   "US",
						"latitude":  float64(79),
						"longitude": float64(22),
						"zip":       "14101",
					},
					"parsed_ua": map[string]interface{}{
						"os_family":  "Mac OS X",
						"os_version": "10.15.5",
						"ua_family":  "Chrome",
						"ua_version": "83.0.4103",
					},
					"user_agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_5) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/83.0.4103.116 Safari/537.36",
				},
				"key2":      "10",
				"source_ip": "10.10.10.10",
			},
		},
		{
			"Process 2.0 ok",
			map[string]interface{}{
				"source_ip":  "10.10.10.10",
				"user_agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_5) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/83.0.4103.116 Safari/537.36",
				"key2":       "10",
			},
			map[string]interface{}{
				"key2": "10",
				"location": map[string]interface{}{
					"city":      "New York",
					"country":   "US",
					"latitude":  float64(79),
					"longitude": float64(22),
					"zip":       "14101",
				},
				"parsed_ua": map[string]interface{}{
					"os_family":  "Mac OS X",
					"os_version": "10.15.5",
					"ua_family":  "Chrome",
					"ua_version": "83.0.4103",
				},
				"source_ip":  "10.10.10.10",
				"user_agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_5) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/83.0.4103.116 Safari/537.36",
			},
		},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			defaultJSIPRule := CreateDefaultJsIPRule(geoService, "")
			defaultJSIPRule.Execute(tt.input)
			DefaultUaRule.Execute(tt.input)
			require.Equal(t, tt.expected, tt.input, "Enriched events aren't equal")
		})
	}
}
