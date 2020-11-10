package events

import (
	"github.com/jitsucom/eventnative/geo"
	"github.com/jitsucom/eventnative/useragent"
	"github.com/stretchr/testify/require"
	"net/http"
	"testing"
)

func TestJsPreprocess(t *testing.T) {
	geoDataMock := &geo.Data{
		Country: "US",
		City:    "New York",
		Lat:     79.00,
		Lon:     22.00,
		Zip:     "14101",
		Region:  "",
	}
	tests := []struct {
		name        string
		input       Fact
		inputReq    *http.Request
		expected    Fact
		expectedErr string
	}{
		{
			"Nil input object",
			nil,
			nil,
			nil,
			"Input fact can't be nil",
		},
		{
			"Empty input object",
			Fact{},
			&http.Request{Header: http.Header{}},
			nil,
			"Unable to get eventn_ctx from map[]",
		},
		{
			"Error eventnKey is not an object",
			Fact{eventnKey: "abc"},
			&http.Request{Header: http.Header{}},
			nil,
			"Unable to cast eventn_ctx to object: abc",
		},
		{
			"Process ok without geo and ua",
			Fact{"eventn_ctx": map[string]interface{}{}},
			&http.Request{Header: http.Header{}},
			Fact{
				"eventn_ctx": map[string]interface{}{
					"location": (*geo.Data)(nil),
				}},
			"",
		},
		{
			"Process ok",
			Fact{"eventn_ctx": map[string]interface{}{"user_agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_5) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/83.0.4103.116 Safari/537.36"}},
			&http.Request{Header: http.Header{"X-Forwarded-For": []string{"10.10.10.10"}}},
			Fact{
				"eventn_ctx": map[string]interface{}{
					"location":   geoDataMock,
					"parsed_ua":  useragent.MockData,
					"user_agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_5) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/83.0.4103.116 Safari/537.36",
				},
				"source_ip": "10.10.10.10"},
			"",
		},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			c2sPreprocessor := &JsPreprocessor{
				geoResolver: geo.Mock{"10.10.10.10": geoDataMock},
				uaResolver:  useragent.Mock{},
			}

			actualFact, actualErr := c2sPreprocessor.Preprocess(tt.input, tt.inputReq)
			if tt.expectedErr == "" {
				require.NoError(t, actualErr)
			} else {
				require.EqualError(t, actualErr, tt.expectedErr, "Errors aren't equal")
			}
			require.Equal(t, tt.expected, actualFact, "Processed facts aren't equal")
		})
	}
}
