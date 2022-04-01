package enrichment

import (
	"github.com/jitsucom/jitsu/server/appconfig"
	"github.com/jitsucom/jitsu/server/events"
	"github.com/jitsucom/jitsu/server/timestamp"
	"github.com/jitsucom/jitsu/server/uuid"
	"github.com/spf13/viper"
	"github.com/stretchr/testify/require"
	"testing"
)

func TestWithJsPreprocess(t *testing.T) {
	SetTestDefaultParams()
	uuid.InitMock()
	timestamp.FreezeTime()
	defer timestamp.UnfreezeTime()

	require.NoError(t, appconfig.Init(false, ""))
	defer appconfig.Instance.Close()
	defer appconfig.Instance.CloseEventsConsumers()

	tests := []struct {
		name     string
		input    map[string]interface{}
		expected map[string]interface{}
		request  *events.RequestContext
	}{
		{
			"Empty input object",
			map[string]interface{}{},
			map[string]interface{}{"_timestamp": "2020-06-16T23:00:00.000000Z", "api_key": "token", "eventn_ctx_event_id": "mockeduuid"},
			&events.RequestContext{},
		},
		{
			"eventnKey is not an object (unique event id won't be set)",
			map[string]interface{}{"eventn_ctx": "abc"},
			map[string]interface{}{"_timestamp": "2020-06-16T23:00:00.000000Z", "api_key": "token", "eventn_ctx": "abc"},
			&events.RequestContext{},
		},
		{
			"Process 1.0 ok",
			map[string]interface{}{"eventn_ctx": map[string]interface{}{"user_agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_5) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/83.0.4103.116 Safari/537.36"}},
			map[string]interface{}{
				"_timestamp": "2020-06-16T23:00:00.000000Z",
				"api_key":    "token",
				"eventn_ctx": map[string]interface{}{
					"event_id":   "mockeduuid",
					"user_agent": "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/77.0.3865.90 Safari/537.36",
				},
				"source_ip": "10.10.10.10",
			},
			&events.RequestContext{ClientIP: "10.10.10.10", UserAgent: "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/77.0.3865.90 Safari/537.36"},
		},
		{
			"Process 2.0 ok",
			map[string]interface{}{
				"user_agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_5) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/83.0.4103.116 Safari/537.36",
				"event_id":   "id1",
			},
			map[string]interface{}{
				"_timestamp":          "2020-06-16T23:00:00.000000Z",
				"api_key":             "token",
				"user_agent":          "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/77.0.3865.90 Safari/537.36",
				"eventn_ctx_event_id": "id1",
				"source_ip":           "10.10.10.10",
			},
			&events.RequestContext{ClientIP: "10.10.10.10", UserAgent: "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/77.0.3865.90 Safari/537.36"},
		},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			jsPreprocessor := events.NewJsProcessor(&events.DummyRecognition{}, viper.GetString("server.fields_configuration.user_agent_path"))

			ContextEnrichmentStep(tt.input, "token", tt.request, jsPreprocessor, appconfig.Instance.GlobalUniqueIDField)

			require.Equal(t, tt.expected, tt.input, "Processed events aren't equal")
		})
	}
}

func TestWithAPIPreprocess(t *testing.T) {
	SetTestDefaultParams()
	uuid.InitMock()
	timestamp.FreezeTime()
	defer timestamp.UnfreezeTime()

	tests := []struct {
		name     string
		input    map[string]interface{}
		expected map[string]interface{}
		request  *events.RequestContext
	}{
		{
			"Empty input object",
			map[string]interface{}{},
			map[string]interface{}{"_timestamp": "2020-06-16T23:00:00.000000Z", "api_key": "token", "eventn_ctx_event_id": "mockeduuid", "src": "api"},
			&events.RequestContext{},
		},
		{
			"eventnKey is not an object (unique event id won't be set)",
			map[string]interface{}{"eventn_ctx": "abc"},
			map[string]interface{}{"_timestamp": "2020-06-16T23:00:00.000000Z", "api_key": "token", "eventn_ctx": "abc", "src": "api"},
			&events.RequestContext{},
		},
		{
			"Process 1.0 ok",
			map[string]interface{}{"eventn_ctx": map[string]interface{}{"user_agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_5) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/83.0.4103.116 Safari/537.36"}},
			map[string]interface{}{
				"_timestamp": "2020-06-16T23:00:00.000000Z",
				"api_key":    "token",
				"eventn_ctx": map[string]interface{}{
					"event_id":   "mockeduuid",
					"user_agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_5) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/83.0.4103.116 Safari/537.36",
				},
				"source_ip": "10.10.10.10",
				"src":       "api",
			},
			&events.RequestContext{ClientIP: "10.10.10.10", UserAgent: "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/77.0.3865.90 Safari/537.36"},
		},
		{
			"Process 2.0 ok",
			map[string]interface{}{
				"event_id":   123,
				"user_agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_5) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/83.0.4103.116 Safari/537.36",
			},
			map[string]interface{}{
				"_timestamp":          "2020-06-16T23:00:00.000000Z",
				"api_key":             "token",
				"eventn_ctx_event_id": "123",
				"user_agent":          "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_5) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/83.0.4103.116 Safari/537.36",
				"source_ip":           "10.10.10.10",
				"src":                 "api",
			},
			&events.RequestContext{ClientIP: "10.10.10.10", UserAgent: "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/77.0.3865.90 Safari/537.36"},
		},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			jsPreprocessor := events.NewAPIProcessor(&events.DummyRecognition{})

			ContextEnrichmentStep(tt.input, "token", tt.request, jsPreprocessor, appconfig.Instance.GlobalUniqueIDField)

			require.Equal(t, tt.expected, tt.input, "Processed events aren't equal")
		})
	}
}

func SetTestDefaultParams() {
	viper.Set("log.path", "")
	viper.Set("server.auth", `{"tokens":[{"id":"id1","client_secret":"c2stoken","server_secret":"s2stoken","origins":["whiteorigin*"]}]}`)
	viper.Set("server.log.path", "")
	viper.Set("sql_debug_log.ddl.enabled", false)
}
