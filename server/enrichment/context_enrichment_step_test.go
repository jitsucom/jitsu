package enrichment

import (
	"bou.ke/monkey"
	"github.com/jitsucom/jitsu/server/events"
	"github.com/jitsucom/jitsu/server/uuid"
	"github.com/stretchr/testify/require"
	"net/http"
	"testing"
	"time"
)

func TestWithJsPreprocess(t *testing.T) {
	uuid.InitMock()
	freezeTime := time.Date(2020, 06, 16, 23, 0, 0, 0, time.UTC)
	patch := monkey.Patch(time.Now, func() time.Time { return freezeTime })
	defer patch.Unpatch()

	tests := []struct {
		name     string
		input    map[string]interface{}
		expected map[string]interface{}
		headers  map[string]string
	}{
		{
			"Empty input object",
			map[string]interface{}{},
			map[string]interface{}{"_timestamp": "2020-06-16T23:00:00.000000Z", "api_key": "token", "eventn_ctx": map[string]interface{}{"event_id": "mockeduuid"}},
			map[string]string{},
		},
		{
			"eventnKey is not an object",
			map[string]interface{}{"eventn_ctx": "abc"},
			map[string]interface{}{"_timestamp": "2020-06-16T23:00:00.000000Z", "api_key": "token", "eventn_ctx": "abc", "eventn_ctx_event_id": "mockeduuid"},
			map[string]string{},
		},
		{
			"Process ok",
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
			map[string]string{"X-Real-IP": "10.10.10.10", "User-Agent": "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/77.0.3865.90 Safari/537.36"},
		},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			jsPreprocessor := events.NewJsPreprocessor()

			r := &http.Request{Header: map[string][]string{}}
			for k, v := range tt.headers {
				r.Header.Add(k, v)
			}

			ContextEnrichmentStep(tt.input, "token", r, jsPreprocessor)

			require.Equal(t, tt.expected, tt.input, "Processed events aren't equal")
		})
	}
}

func TestWithAPIPreprocess(t *testing.T) {
	uuid.InitMock()
	freezeTime := time.Date(2020, 06, 16, 23, 0, 0, 0, time.UTC)
	patch := monkey.Patch(time.Now, func() time.Time { return freezeTime })
	defer patch.Unpatch()

	tests := []struct {
		name     string
		input    map[string]interface{}
		expected map[string]interface{}
		headers  map[string]string
	}{
		{
			"Empty input object",
			map[string]interface{}{},
			map[string]interface{}{"_timestamp": "2020-06-16T23:00:00.000000Z", "api_key": "token", "eventn_ctx": map[string]interface{}{"event_id": "mockeduuid"}, "src": "api"},
			map[string]string{},
		},
		{
			"eventnKey is not an object",
			map[string]interface{}{"eventn_ctx": "abc"},
			map[string]interface{}{"_timestamp": "2020-06-16T23:00:00.000000Z", "api_key": "token", "eventn_ctx": "abc", "eventn_ctx_event_id": "mockeduuid", "src": "api"},
			map[string]string{},
		},
		{
			"Process ok",
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
			map[string]string{"X-Real-IP": "10.10.10.10", "User-Agent": "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/77.0.3865.90 Safari/537.36"},
		},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			jsPreprocessor := events.NewAPIPreprocessor()

			r := &http.Request{Header: map[string][]string{}}
			for k, v := range tt.headers {
				r.Header.Add(k, v)
			}

			ContextEnrichmentStep(tt.input, "token", r, jsPreprocessor)

			require.Equal(t, tt.expected, tt.input, "Processed events aren't equal")
		})
	}
}
