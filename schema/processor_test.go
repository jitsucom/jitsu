package schema

import (
	"github.com/jitsucom/eventnative/appconfig"
	"github.com/jitsucom/eventnative/enrichment"
	"github.com/jitsucom/eventnative/geo"
	"github.com/jitsucom/eventnative/test"
	"github.com/jitsucom/eventnative/timestamp"
	"github.com/jitsucom/eventnative/typing"
	"github.com/jitsucom/eventnative/useragent"
	"github.com/stretchr/testify/require"
	"io/ioutil"
	"testing"
	"time"
)

func TestProcessFilePayload(t *testing.T) {
	testTime1, _ := time.Parse(timestamp.Layout, "2020-07-02T18:23:59.757719Z")
	testTime2, _ := time.Parse(timestamp.Layout, "2020-08-02T18:23:56.291383Z")
	testTime3, _ := time.Parse(timestamp.Layout, "2020-08-02T18:23:59.757719Z")
	testTime4, _ := time.Parse(timestamp.Layout, "2020-08-02T18:23:58.057807Z")

	tests := []struct {
		name          string
		inputFilePath string
		expected      map[string]*ProcessedFile
	}{
		{
			"Empty input file",
			"../test_data/fact_input_empty.log",
			map[string]*ProcessedFile{},
		},
		{
			"Input file with some errors",
			"../test_data/fact_input_with_error_lines.log",
			map[string]*ProcessedFile{
				"user_2020_07": {FileName: "testfile", payload: []map[string]interface{}{
					{"_geo_data_region": "NY", "_timestamp": testTime1, "event_type": "user", "key1": 120.0, "key3": "privvvv"},
				},
					DataSchema: &Table{Name: "user_2020_07",
						PKFields: map[string]bool{},
						Columns: Columns{
							"_geo_data_region": NewColumn(typing.STRING),
							"_timestamp":       NewColumn(typing.TIMESTAMP),
							"event_type":       NewColumn(typing.STRING),
							"key1":             NewColumn(typing.FLOAT64),
							"key3":             NewColumn(typing.STRING)}},
				},

				"user_2020_08": {FileName: "testfile", payload: []map[string]interface{}{
					{"_geo_data_country": "US", "_geo_data_city": "New York", "_timestamp": testTime2, "event_type": "user", "key1_key2": "splu", "key10_sib1_1": "k"},
					{"_geo_data_country": "US", "_geo_data_city": "New York", "_timestamp": testTime2, "event_type": "user", "key1_key2": "splu", "key10_sib1_1": 50.0},
					{"_geo_data_zip": int64(10128), "_timestamp": testTime3, "event_type": "user", "key1": "10", "key10": "[1,2,3,4]", "key3": "privvvv"},
				},
					DataSchema: &Table{Name: "user_2020_08", PKFields: map[string]bool{}, Columns: Columns{
						"_geo_data_city":    NewColumn(typing.STRING),
						"_geo_data_country": NewColumn(typing.STRING),
						"_geo_data_zip":     NewColumn(typing.INT64),
						"_timestamp":        NewColumn(typing.TIMESTAMP),
						"event_type":        NewColumn(typing.STRING),
						"key1":              NewColumn(typing.STRING),
						"key10":             NewColumn(typing.STRING),
						"key10_sib1_1": Column{
							dataType:       nil,
							typeOccurrence: map[typing.DataType]bool{typing.STRING: true, typing.FLOAT64: true},
						},
						"key1_key2": NewColumn(typing.STRING),
						"key3":      NewColumn(typing.STRING)}},
				},

				"notification_2020_08": {FileName: "testfile", payload: []map[string]interface{}{
					{"_geo_data_latitude": 40.7809, "_geo_data_longitude": -73.9502, "_timestamp": testTime4, "event_type": "notification", "key1_key2": "123", "key3": "privvvv", "key5": "[1,2,4,5]"},
				},
					DataSchema: &Table{Name: "notification_2020_08", PKFields: map[string]bool{}, Columns: Columns{
						"_geo_data_latitude":  NewColumn(typing.FLOAT64),
						"_geo_data_longitude": NewColumn(typing.FLOAT64),
						"_timestamp":          NewColumn(typing.TIMESTAMP),
						"event_type":          NewColumn(typing.STRING),
						"key1_key2":           NewColumn(typing.STRING),
						"key5":                NewColumn(typing.STRING),
						"key3":                NewColumn(typing.STRING)}},
				},

				"null_2020_08": {FileName: "testfile", payload: []map[string]interface{}{
					{"_geo_data_region": "null", "_timestamp": testTime3, "key1": 9999999.0},
				},
					DataSchema: &Table{Name: "null_2020_08", PKFields: map[string]bool{}, Columns: Columns{
						"_geo_data_region": NewColumn(typing.STRING),
						"_timestamp":       NewColumn(typing.TIMESTAMP),
						"key1":             NewColumn(typing.FLOAT64)}},
				},
			},
		},
	}
	p, err := NewProcessor(`{{.event_type}}_{{._timestamp.Format "2006_01"}}`, []string{}, Default, map[string]bool{}, nil)
	require.NoError(t, err)
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			fBytes, err := ioutil.ReadFile(tt.inputFilePath)
			require.NoError(t, err)

			actual, err := p.ProcessFilePayload("testfile", fBytes, false)
			require.NoError(t, err)

			require.Equal(t, len(tt.expected), len(actual), "Result sizes aren't equal")

			for k, v := range actual {
				expectedUnit := tt.expected[k]
				require.NotNil(t, expectedUnit, k, "doesn't exist in actual result")
				test.ObjectsEqual(t, expectedUnit.FileName, v.FileName, k+" results filenames aren't equal")
				test.ObjectsEqual(t, expectedUnit.payload, v.payload, k+" results payloads aren't equal")
				test.ObjectsEqual(t, expectedUnit.DataSchema, v.DataSchema, k+" results data schemas aren't equal")

			}
		})
	}
}

func TestProcessFact(t *testing.T) {
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
		name           string
		input          map[string]interface{}
		expectedTable  *Table
		expectedObject map[string]interface{}
		expectedErr    string
	}{
		{
			"Empty input fact - error",
			map[string]interface{}{},
			nil,
			map[string]interface{}{},
			"Error extracting table name from object {map[]}: Error extracting table name: _timestamp field doesn't exist",
		},
		{
			"input without ip and ua ok",
			map[string]interface{}{"_timestamp": "2020-08-02T18:23:58.057807Z"},
			&Table{Name: "events_2020_08", PKFields: map[string]bool{}, Columns: Columns{
				"_timestamp": NewColumn(typing.TIMESTAMP)}},
			map[string]interface{}{"_timestamp": testTime},
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
			&Table{Name: "events_2020_08", PKFields: map[string]bool{}, Columns: Columns{
				"_timestamp":           NewColumn(typing.TIMESTAMP),
				"field2_ip":            NewColumn(typing.STRING),
				"field2_ua":            NewColumn(typing.STRING),
				"field3_device_family": NewColumn(typing.STRING),
				"field3_os_family":     NewColumn(typing.STRING),
				"field3_os_version":    NewColumn(typing.STRING),
				"field3_ua_family":     NewColumn(typing.STRING),
				"field3_ua_version":    NewColumn(typing.STRING),
				"field4_city":          NewColumn(typing.STRING),
				"field4_country":       NewColumn(typing.STRING),
				"field4_latitude":      NewColumn(typing.FLOAT64),
				"field4_longitude":     NewColumn(typing.FLOAT64),
				"field4_zip":           NewColumn(typing.STRING),
			}},
			map[string]interface{}{
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
	appconfig.Init()
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

	p, err := NewProcessor(`events_{{._timestamp.Format "2006_01"}}`,
		[]string{"/field1->/field2"}, Default, map[string]bool{}, []enrichment.Rule{uaRule, ipRule})
	require.NoError(t, err)
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			table, actual, err := p.ProcessFact(tt.input)

			if tt.expectedErr != "" {
				require.Error(t, err)
				require.Equal(t, tt.expectedErr, err.Error())
			} else {
				require.NoError(t, err)

				test.ObjectsEqual(t, tt.expectedTable, table, "Table schema results aren't equal")
				test.ObjectsEqual(t, tt.expectedObject, actual, "Processed objects aren't equal")
			}
		})
	}
}
