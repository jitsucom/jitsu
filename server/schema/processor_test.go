package schema

import (
	"github.com/spf13/viper"
	"io/ioutil"
	"testing"
	"time"

	"github.com/jitsucom/jitsu/server/appconfig"
	"github.com/jitsucom/jitsu/server/enrichment"
	"github.com/jitsucom/jitsu/server/events"
	"github.com/jitsucom/jitsu/server/geo"
	"github.com/jitsucom/jitsu/server/parsers"
	"github.com/jitsucom/jitsu/server/test"
	"github.com/jitsucom/jitsu/server/timestamp"
	"github.com/jitsucom/jitsu/server/typing"
	"github.com/jitsucom/jitsu/server/useragent"
	"github.com/stretchr/testify/require"
)

func TestProcessFilePayload(t *testing.T) {
	viper.Set("server.log.path", "")

	err := appconfig.Init(false)
	require.NoError(t, err)

	testTime1, _ := time.Parse(time.RFC3339Nano, "2020-07-02T18:23:59.757719Z")
	testTime2, _ := time.Parse(time.RFC3339Nano, "2020-08-02T18:23:56.291383Z")
	testTime3, _ := time.Parse(time.RFC3339Nano, "2020-08-02T18:23:59.757719Z")
	testTime4, _ := time.Parse(time.RFC3339Nano, "2020-08-02T18:23:58.057807Z")

	tests := []struct {
		name           string
		parseFunc      func([]byte) (map[string]interface{}, error)
		inputFilePath  string
		expected       map[string]*ProcessedFile
		expectedFailed []events.FailedEvent
	}{
		{
			"Empty input file",
			parsers.ParseJson,
			"../test_data/fact_input_empty.log",
			map[string]*ProcessedFile{},
			[]events.FailedEvent{},
		},
		{
			"Input file with some errors and one skipped line",
			parsers.ParseJson,
			"../test_data/fact_input_with_error_lines.log",
			map[string]*ProcessedFile{
				"user_2020_07": {FileName: "testfile", payload: []map[string]interface{}{
					{"_geo_data_region": "NY", "_timestamp": testTime1, "event_type": "user", "key1": 120.0, "key3": "privvvv"},
				},
					BatchHeader: &BatchHeader{TableName: "user_2020_07",
						Fields: Fields{
							"_geo_data_region": NewField(typing.STRING),
							"_timestamp":       NewField(typing.TIMESTAMP),
							"event_type":       NewField(typing.STRING),
							"key1":             NewField(typing.FLOAT64),
							"key3":             NewField(typing.STRING)}},
				},

				"user_2020_08": {FileName: "testfile", payload: []map[string]interface{}{
					{"_geo_data_country": "US", "_geo_data_city": "New York", "_timestamp": testTime2, "event_type": "user", "key1_key2": "splu", "key10_sib1_1": "k"},
					{"_geo_data_country": "US", "_geo_data_city": "New York", "_timestamp": testTime2, "event_type": "user", "key1_key2": "splu", "key10_sib1_1": 50.0},
					{"_geo_data_zip": int64(10128), "_timestamp": testTime3, "event_type": "user", "key1": "10", "key10": "[1,2,3,4]", "key3": "privvvv"},
				},
					BatchHeader: &BatchHeader{TableName: "user_2020_08", Fields: Fields{
						"_geo_data_city":    NewField(typing.STRING),
						"_geo_data_country": NewField(typing.STRING),
						"_geo_data_zip":     NewField(typing.INT64),
						"_timestamp":        NewField(typing.TIMESTAMP),
						"event_type":        NewField(typing.STRING),
						"key1":              NewField(typing.STRING),
						"key10":             NewField(typing.STRING),
						"key10_sib1_1": Field{
							dataType:       nil,
							typeOccurrence: map[typing.DataType]bool{typing.STRING: true, typing.FLOAT64: true},
						},
						"key1_key2": NewField(typing.STRING),
						"key3":      NewField(typing.STRING)}},
				},

				"notification_2020_08": {FileName: "testfile", payload: []map[string]interface{}{
					{"_geo_data_latitude": 40.7809, "_geo_data_longitude": -73.9502, "_timestamp": testTime4, "event_type": "notification", "key1_key2": "123", "key3": "privvvv", "key5": "[1,2,4,5]"},
				},
					BatchHeader: &BatchHeader{TableName: "notification_2020_08", Fields: Fields{
						"_geo_data_latitude":  NewField(typing.FLOAT64),
						"_geo_data_longitude": NewField(typing.FLOAT64),
						"_timestamp":          NewField(typing.TIMESTAMP),
						"event_type":          NewField(typing.STRING),
						"key1_key2":           NewField(typing.STRING),
						"key5":                NewField(typing.STRING),
						"key3":                NewField(typing.STRING)}},
				},

				"null_2020_08": {FileName: "testfile", payload: []map[string]interface{}{
					{"_geo_data_region": "null", "_timestamp": testTime3, "key1": 9999999.0},
				},
					BatchHeader: &BatchHeader{TableName: "null_2020_08", Fields: Fields{
						"_geo_data_region": NewField(typing.STRING),
						"_timestamp":       NewField(typing.TIMESTAMP),
						"key1":             NewField(typing.FLOAT64)}},
				},
			},
			[]events.FailedEvent{{Event: []byte(`{"_geo_data":{},"event_type":"views","key1000":"super value"}`), Error: "Error extracting table name: _timestamp field doesn't exist"}},
		},
		{
			"Input fallback file",
			parsers.ParseFallbackJson,
			"../test_data/fallback_fact_input.log",
			map[string]*ProcessedFile{
				"user_2020_08": {FileName: "testfile", payload: []map[string]interface{}{
					{"_geo_data_country": "US", "_geo_data_city": "New York", "_timestamp": testTime2, "event_type": "user", "key1_key2": "splu", "key10_sib1_1": "k"},
				},
					BatchHeader: &BatchHeader{TableName: "user_2020_08", Fields: Fields{
						"_geo_data_city":    NewField(typing.STRING),
						"_geo_data_country": NewField(typing.STRING),
						"_timestamp":        NewField(typing.TIMESTAMP),
						"event_type":        NewField(typing.STRING),
						"key10_sib1_1":      NewField(typing.STRING),
						"key1_key2":         NewField(typing.STRING)}},
				},

				"null_2020_08": {FileName: "testfile", payload: []map[string]interface{}{
					{"_geo_data_latitude": 40.7809, "_geo_data_longitude": -73.9502, "_timestamp": testTime4, "key1_key2": "123", "key3": "privvvv", "key5": "[1,2,4,5]"},
				},
					BatchHeader: &BatchHeader{TableName: "null_2020_08", Fields: Fields{
						"_geo_data_latitude":  NewField(typing.FLOAT64),
						"_geo_data_longitude": NewField(typing.FLOAT64),
						"_timestamp":          NewField(typing.TIMESTAMP),
						"key1_key2":           NewField(typing.STRING),
						"key5":                NewField(typing.STRING),
						"key3":                NewField(typing.STRING)}},
				},
			},
			[]events.FailedEvent{},
		},
	}
	p, err := NewProcessor("test", `{{if .event_type}}{{if eq .event_type "skipped"}}{{else}}{{.event_type}}_{{._timestamp.Format "2006_01"}}{{end}}{{else}}{{.event_type}}_{{._timestamp.Format "2006_01"}}{{end}}`, &DummyMapper{}, []enrichment.Rule{}, NewFlattener(), NewTypeResolver(), false)
	require.NoError(t, err)
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			fBytes, err := ioutil.ReadFile(tt.inputFilePath)
			require.NoError(t, err)

			actual, failed, err := p.ProcessFilePayload("testfile", fBytes, map[string]bool{}, tt.parseFunc)
			require.NoError(t, err)

			if len(tt.expectedFailed) > 0 {
				require.Equal(t, len(tt.expectedFailed), len(failed), "Failed objects quantity isn't equal")
				for i, failedObj := range failed {
					test.ObjectsEqual(t, tt.expectedFailed[i], *failedObj)
				}
			} else {
				require.Empty(t, failed)
			}

			require.Equal(t, len(tt.expected), len(actual), "Result sizes aren't equal")

			for k, v := range actual {
				expectedUnit := tt.expected[k]
				require.NotNil(t, expectedUnit, k, "doesn't exist in actual result")
				test.ObjectsEqual(t, expectedUnit.FileName, v.FileName, k+" results filenames aren't equal")
				test.ObjectsEqual(t, expectedUnit.payload, v.payload, k+" results payloads aren't equal")
				test.ObjectsEqual(t, expectedUnit.BatchHeader, v.BatchHeader, k+" results data schemas aren't equal")

			}
		})
	}
}

func TestProcessFact(t *testing.T) {
	viper.Set("server.log.path", "")

	err := appconfig.Init(false)
	require.NoError(t, err)

	testTime, _ := time.Parse(timestamp.Layout, "2020-08-02T18:23:58.057807Z")

	geoDataMock := &geo.Data{
		Country: "US",
		City:    "New York",
		Lat:     79.01,
		Lon:     22.02,
		Zip:     "14101",
		Region:  "",
	}

	tests := []struct {
		name                string
		input               map[string]interface{}
		expectedBatchHeader *BatchHeader
		expectedObject      events.Event
		expectedErr         string
	}{
		{
			"Empty input event - error",
			map[string]interface{}{},
			nil,
			map[string]interface{}{},
			"Error extracting table name: _timestamp field doesn't exist",
		},
		{
			"input without ip and ua ok",
			map[string]interface{}{"_timestamp": "2020-08-02T18:23:58.057807Z"},
			&BatchHeader{TableName: "events_2020_08", Fields: Fields{
				"_timestamp": NewField(typing.TIMESTAMP)}},
			events.Event{"_timestamp": testTime},
			"",
		},
		{
			"input with ip and ua ok",
			map[string]interface{}{
				"_timestamp": "2020-08-02T18:23:58.057807Z",
				"field1": map[string]interface{}{
					"ua": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_5) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/83.0.4103.116 Safari/537.36",
					"ip": "10.10.10.10",
				},
			},
			&BatchHeader{TableName: "events_2020_08", Fields: Fields{
				"_timestamp":           NewField(typing.TIMESTAMP),
				"field2_ip":            NewField(typing.STRING),
				"field2_ua":            NewField(typing.STRING),
				"field3_device_family": NewField(typing.STRING),
				"field3_os_family":     NewField(typing.STRING),
				"field3_os_version":    NewField(typing.STRING),
				"field3_ua_family":     NewField(typing.STRING),
				"field3_ua_version":    NewField(typing.STRING),
				"field4_city":          NewField(typing.STRING),
				"field4_country":       NewField(typing.STRING),
				"field4_latitude":      NewField(typing.FLOAT64),
				"field4_longitude":     NewField(typing.FLOAT64),
				"field4_zip":           NewField(typing.STRING),
			}},
			events.Event{
				"_timestamp":           testTime,
				"field2_ip":            "10.10.10.10",
				"field2_ua":            "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_5) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/83.0.4103.116 Safari/537.36",
				"field3_device_family": "PK",
				"field3_os_family":     "Windows",
				"field3_os_version":    "95",
				"field3_ua_family":     "Chrome",
				"field3_ua_version":    "1.0.0",
				"field4_city":          "New York",
				"field4_country":       "US",
				"field4_latitude":      79.01,
				"field4_longitude":     22.02,
				"field4_zip":           "14101",
			},
			"",
		},
	}
	appconfig.Init(false)
	appconfig.Instance.GeoResolver = geo.Mock{"10.10.10.10": geoDataMock}
	appconfig.Instance.UaResolver = useragent.Mock{}
	uaRule, err := enrichment.NewRule(&enrichment.RuleConfig{
		Name: enrichment.UserAgentParse,
		From: "/field1/ua",
		To:   "/field3",
	})
	require.NoError(t, err)
	ipRule, err := enrichment.NewRule(&enrichment.RuleConfig{
		Name: enrichment.IpLookup,
		From: "/field1/ip",
		To:   "/field4",
	})
	require.NoError(t, err)

	fieldMapper, _, err := NewFieldMapper(Default, []string{"/field1->/field2"}, nil)
	require.NoError(t, err)

	p, err := NewProcessor("test", `events_{{._timestamp.Format "2006_01"}}`, fieldMapper, []enrichment.Rule{uaRule, ipRule}, NewFlattener(), NewTypeResolver(), false)

	require.NoError(t, err)
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			batchHeader, actual, err := p.ProcessEvent(tt.input)

			if tt.expectedErr != "" {
				require.Error(t, err)
				require.Equal(t, tt.expectedErr, err.Error())
			} else {
				require.NoError(t, err)

				test.ObjectsEqual(t, tt.expectedBatchHeader, batchHeader, "BatchHeader results aren't equal")
				test.ObjectsEqual(t, tt.expectedObject, actual, "Processed objects aren't equal")
			}
		})
	}
}
