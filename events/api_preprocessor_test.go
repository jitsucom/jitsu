package events

import (
	"github.com/jitsucom/eventnative/appconfig"
	"github.com/jitsucom/eventnative/geo"
	"github.com/jitsucom/eventnative/useragent"
	"github.com/jitsucom/eventnative/uuid"
	"github.com/stretchr/testify/require"
	"testing"
)

func TestApiPreprocess(t *testing.T) {
	uuid.InitMock()

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
		expected    Fact
		expectedErr string
	}{
		{
			"Nil input object",
			nil,
			nil,
			"Input fact can't be nil",
		},
		{
			"Empty input object",
			Fact{},
			Fact{"eventn_ctx": map[string]interface{}{"event_id": "mockeduuid"}, "src": "api"},
			"",
		},
		{
			"Process ok without device ctx and with eventn_ctx",
			Fact{
				"source_ip":    "10.10.10.10",
				"eventn_ctx":   map[string]interface{}{"key1": "key2"},
				"event_origin": "api_test",
				"src":          "123",
				"event_data":   map[string]interface{}{"key1": "key2"},
				"user":         map[string]interface{}{"id": "123"},
				"page_ctx":     map[string]interface{}{"referer": "www.site.com"}},
			Fact{
				"eventn_ctx":   map[string]interface{}{"event_id": "mockeduuid", "key1": "key2"},
				"event_data":   map[string]interface{}{"key1": "key2"},
				"event_origin": "api_test",
				"user":         map[string]interface{}{"id": "123"},
				"page_ctx":     map[string]interface{}{"referer": "www.site.com"},
				"src":          "api",
				"source_ip":    "10.10.10.10",
			},
			"",
		},
		{
			"Process ok with device ctx but without ip and ua without eventn_ctx",
			Fact{
				"source_ip":    "10.10.10.10",
				"event_origin": "api_test",
				"src":          "123",
				"event_data":   map[string]interface{}{"key1": "key2"},
				"user":         map[string]interface{}{"id": "123"},
				"page_ctx":     map[string]interface{}{"referer": "www.site.com"},
				"device_ctx":   map[string]interface{}{"ip": "10.10.10.10"}},
			Fact{
				"eventn_ctx": map[string]interface{}{
					"event_id": "mockeduuid",
				},
				"device_ctx": map[string]interface{}{
					"ip": "10.10.10.10",
				},
				"event_data":   map[string]interface{}{"key1": "key2"},
				"event_origin": "api_test",
				"user":         map[string]interface{}{"id": "123"},
				"page_ctx":     map[string]interface{}{"referer": "www.site.com"},
				"src":          "api",
				"source_ip":    "10.10.10.10",
			},
			"",
		},
		{
			"Process ok with device ctx with ip and ua and with eventn not object",
			Fact{
				"source_ip":    "10.10.10.10",
				"eventn_ctx":   "somevalue",
				"event_origin": "api_test",
				"src":          "123",
				"event_data":   map[string]interface{}{"key1": "key2"},
				"user":         map[string]interface{}{"id": "123"},
				"page_ctx":     map[string]interface{}{"referer": "www.site.com"},
				"device_ctx":   map[string]interface{}{"ip": "20.20.20.20"}},
			Fact{
				"eventn_ctx":          "somevalue",
				"eventn_ctx_event_id": "mockeduuid",
				"device_ctx": map[string]interface{}{
					"ip": "20.20.20.20",
				},
				"event_data":   map[string]interface{}{"key1": "key2"},
				"event_origin": "api_test",
				"user":         map[string]interface{}{"id": "123"},
				"page_ctx":     map[string]interface{}{"referer": "www.site.com"},
				"src":          "api",
				"source_ip":    "10.10.10.10",
			},
			"",
		},
		{
			"Process ok with device ctx with ip and ua",
			Fact{
				"source_ip":    "10.10.10.10",
				"event_origin": "api_test",
				"src":          "123",
				"event_data":   map[string]interface{}{"key1": "key2"},
				"user":         map[string]interface{}{"id": "123"},
				"page_ctx":     map[string]interface{}{"referer": "www.site.com"},
				"device_ctx":   map[string]interface{}{"ip": "20.20.20.20", "user_agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_6) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/86.0.4240.198 Safari/537.36"}},
			Fact{
				"eventn_ctx": map[string]interface{}{"event_id": "mockeduuid", "location": geoDataMock, "parsed_ua": useragent.MockData},
				"device_ctx": map[string]interface{}{
					"ip":         "20.20.20.20",
					"user_agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_6) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/86.0.4240.198 Safari/537.36",
				},
				"event_data":   map[string]interface{}{"key1": "key2"},
				"event_origin": "api_test",
				"user":         map[string]interface{}{"id": "123"},
				"page_ctx":     map[string]interface{}{"referer": "www.site.com"},
				"src":          "api",
				"source_ip":    "10.10.10.10",
			},
			"",
		},
		{
			"Process ok with location and parsed ua with eventn id",
			Fact{
				"source_ip":    "10.10.10.10",
				"eventn_ctx":   map[string]interface{}{"event_id": "123"},
				"event_origin": "api_test",
				"src":          "123",
				"event_data":   map[string]interface{}{"key1": "key2"},
				"user":         map[string]interface{}{"id": "123"},
				"page_ctx":     map[string]interface{}{"referer": "www.site.com"},
				"device_ctx": map[string]interface{}{
					"ip":        "20.20.20.20",
					"ua":        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_6) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/86.0.4240.198 Safari/537.36",
					"location":  map[string]interface{}{"custom_location": "123"},
					"parsed_ua": map[string]interface{}{"custom_ua": "123"},
				}},
			Fact{
				"eventn_ctx": map[string]interface{}{"event_id": "123"},
				"device_ctx": map[string]interface{}{
					"ip":        "20.20.20.20",
					"ua":        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_6) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/86.0.4240.198 Safari/537.36",
					"location":  map[string]interface{}{"custom_location": "123"},
					"parsed_ua": map[string]interface{}{"custom_ua": "123"},
				},
				"event_data":   map[string]interface{}{"key1": "key2"},
				"event_origin": "api_test",
				"user":         map[string]interface{}{"id": "123"},
				"page_ctx":     map[string]interface{}{"referer": "www.site.com"},
				"src":          "api",
				"source_ip":    "10.10.10.10",
			},
			"",
		},
		{
			"Process ok different schema",
			Fact{
				"source_ip": "10.10.10.10",
				"billing":   []string{"1", "2"},
				"keys":      map[string]interface{}{"key1": "key2"},
				"weather":   map[string]interface{}{"id": "123", "type": "good"}},
			Fact{
				"eventn_ctx": map[string]interface{}{"event_id": "mockeduuid"},
				"billing":    []string{"1", "2"},
				"keys":       map[string]interface{}{"key1": "key2"},
				"weather":    map[string]interface{}{"id": "123", "type": "good"},
				"src":        "api",
				"source_ip":  "10.10.10.10",
			},
			"",
		},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			appconfig.Init()
			appconfig.Instance.GeoResolver = geo.Mock{"20.20.20.20": geoDataMock}
			appconfig.Instance.UaResolver = useragent.Mock{}
			apiPreprocessor, err := NewApiPreprocessor()
			require.NoError(t, err)

			actualFact, actualErr := apiPreprocessor.Preprocess(tt.input)
			if tt.expectedErr == "" {
				require.NoError(t, actualErr)
			} else {
				require.EqualError(t, actualErr, tt.expectedErr, "Errors aren't equal")
			}
			require.Equal(t, tt.expected, actualFact, "Processed facts aren't equal")
		})
	}
}
