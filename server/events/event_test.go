package events

import (
	"github.com/stretchr/testify/require"
	"testing"
)

func TestParseFallbackJSON(t *testing.T) {
	tests := []struct {
		name         string
		inputEvent   string
		expectObject map[string]interface{}
		expectedErr  string
	}{
		{
			"empty object",
			`{}`,
			map[string]interface{}{},
			"'event' field can't be empty in fallback object: {}",
		},
		{
			"input event",
			`{"event":{"_timestamp":"2022-01-26T15:08:24.692087Z","api_key":"js.123.aaa","app":"jitsu_cloud"},"error":"some error"}`,
			map[string]interface{}{
				"_timestamp": "2022-01-26T15:08:24.692087Z",
				"api_key":    "js.123.aaa",
				"app":        "jitsu_cloud",
			},
			"",
		},
		{
			"input malformed event",
			`{"malformed_event":"{\"_timestamp\":\"2022-01-26T15:08:24.692087Z\",\"api_key\":\"js.123.aaa\"{\"aa\":123,\"app\":\"jitsu_cloud\"}","error":"malformed event"}`,
			nil,
			"event: {\"_timestamp\":\"2022-01-26T15:08:24.692087Z\",\"api_key\":\"js.123.aaa\"{\"aa\":123,\"app\":\"jitsu_cloud\"} was sent to fallback because it is malformed (not valid JSON): malformed event",
		},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			actual, err := ParseFallbackJSON([]byte(tt.inputEvent))
			if tt.expectedErr != "" {
				require.EqualError(t, err, tt.expectedErr, "Errors aren't equal")
			} else {
				require.NoError(t, err)
				require.Equal(t, tt.expectObject, actual)
			}
		})
	}
}
