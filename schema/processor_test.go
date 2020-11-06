package schema

import (
	"github.com/ksensehq/eventnative/test"
	"github.com/ksensehq/eventnative/timestamp"
	"github.com/ksensehq/eventnative/typing"
	"github.com/stretchr/testify/require"
	"io/ioutil"
	"testing"
	"time"
)

func TestProcess(t *testing.T) {
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
					DataSchema: &Table{Name: "user_2020_08", Columns: Columns{
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
					DataSchema: &Table{Name: "notification_2020_08", Columns: Columns{
						"_geo_data_latitude":  NewColumn(typing.FLOAT64),
						"_geo_data_longitude": NewColumn(typing.FLOAT64),
						"_timestamp":          NewColumn(typing.TIMESTAMP),
						"event_type":          NewColumn(typing.STRING),
						"key1_key2":           NewColumn(typing.STRING),
						"key5":                NewColumn(typing.STRING),
						"key3":                NewColumn(typing.STRING)}},
				},
			},
		},
	}
	p, err := NewProcessor(`{{.event_type}}_{{._timestamp.Format "2006_01"}}`, []string{}, Default)
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
