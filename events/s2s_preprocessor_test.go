package events

import (
	"github.com/ksensehq/eventnative/geo"
	"github.com/ksensehq/eventnative/useragent"
	"github.com/stretchr/testify/require"
	"net/http"
	"testing"
)

func TestS2SPreprocess(t *testing.T) {
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
			Fact{
				"event_data": nil,
				"eventn_ctx": map[string]interface{}{
					"event_id": interface{}(nil),
					"user":     interface{}(nil)},
				"src": "s2s"},
			"",
		},
		{
			"Process ok without device ctx",
			Fact{
				"event_type": "s2s_test",
				"src":        "123",
				"event_data": map[string]interface{}{"key1": "key2"},
				"user":       map[string]interface{}{"id": "123"},
				"page_ctx":   map[string]interface{}{"referer": "www.site.com"}},
			&http.Request{Header: http.Header{"X-Forwarded-For": []string{"10.10.10.10"}}},
			Fact{
				"event_data": map[string]interface{}{"key1": "key2"},
				"eventn_ctx": map[string]interface{}{
					"event_id": interface{}(nil),
					"referer":  "www.site.com",
					"user":     map[string]interface{}{"id": "123"}},
				"src": "s2s"},
			"",
		},
		{
			"Process ok with device ctx but without ip and ua",
			Fact{
				"event_type": "s2s_test",
				"src":        "123",
				"event_data": map[string]interface{}{"key1": "key2"},
				"user":       map[string]interface{}{"id": "123"},
				"page_ctx":   map[string]interface{}{"referer": "www.site.com"},
				"device_ctx": map[string]interface{}{"ip": "10.10.10.10"}},
			&http.Request{Header: http.Header{"X-Forwarded-For": []string{"10.10.10.10"}}},
			Fact{
				"event_data": map[string]interface{}{"key1": "key2"},
				"eventn_ctx": map[string]interface{}{"event_id": interface{}(nil),
					"location": (*geo.Data)(nil),
					"referer":  "www.site.com",
					"user":     map[string]interface{}{"id": "123"}},
				"src": "s2s"},
			"",
		},
		{
			"Process ok with device ctx with ip and ua",
			Fact{
				"event_type": "s2s_test",
				"src":        "123",
				"event_data": map[string]interface{}{"key1": "key2"},
				"user":       map[string]interface{}{"id": "123"},
				"page_ctx":   map[string]interface{}{"referer": "www.site.com"},
				"device_ctx": map[string]interface{}{"ip": "20.20.20.20"}},
			&http.Request{Header: http.Header{"X-Forwarded-For": []string{"10.10.10.10"}}},
			Fact{
				"event_data": map[string]interface{}{"key1": "key2"},
				"eventn_ctx": map[string]interface{}{
					"event_id": interface{}(nil),
					"location": geoDataMock,
					"referer":  "www.site.com",
					"user":     map[string]interface{}{"id": "123"}},
				"src": "s2s"},
			"",
		},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			s2sPreprocessor := &S2SPreprocessor{
				geoResolver: geo.Mock{"20.20.20.20": geoDataMock},
				uaResolver:  useragent.Mock{},
			}

			actualFact, actualErr := s2sPreprocessor.Preprocess(tt.input, tt.inputReq)
			if tt.expectedErr == "" {
				require.NoError(t, actualErr)
			} else {
				require.EqualError(t, actualErr, tt.expectedErr, "Errors aren't equal")
			}
			require.Equal(t, tt.expected, actualFact, "Processed facts aren't equal")
		})
	}
}
