package schema

import (
	"bytes"
	"github.com/ksenseai/tracker/test"
	"github.com/stretchr/testify/require"
	"io/ioutil"
	"strings"
	"testing"
)

func TestFlattenObject(t *testing.T) {
	tests := []struct {
		name         string
		inputJson    map[string]interface{}
		expectedJson map[string]interface{}
	}{
		{
			"Empty input json",
			map[string]interface{}{},
			map[string]interface{}{},
		},
		{
			"Null pointer input json",
			nil,
			map[string]interface{}{},
		},
		{
			"Nested input json",
			map[string]interface{}{
				"key1": "value1",
				"key2": 2,
				"key3": nil,
				"key4": []string{},
				"key5": []int{1, 2, 3, 4},
				"key6": map[string]interface{}{},
				"key7": []float64{1.0, 0.8884213},
				"key8": map[string]interface{}{
					"sub_key1": "event",
					"sub_key2": 123123.3123,
					"sub_key3": map[string]interface{}{
						"sub_sub_key1": []string{"1,", "2."}},
				}},
			map[string]interface{}{"key1": "value1", "key2": "2", "key4": "[]", "key5": "[1,2,3,4]", "key7": "[1,0.8884213]", "key8_sub_key1": "event",
				"key8_sub_key2": "123123.3123", "key8_sub_key3_sub_sub_key1": "[\"1,\",\"2.\"]"},
		},
	}
	p, err := NewProcessor("", []string{})
	require.NoError(t, err)
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			actualFlattenJson, err := p.flattenObject(tt.inputJson)
			require.NoError(t, err)
			test.ObjectsEqual(t, tt.expectedJson, actualFlattenJson, "Wrong flattened json")
		})
	}
}

func TestProcess(t *testing.T) {
	tests := []struct {
		name           string
		inputFilePath  string
		expectedResult map[string]*ProcessedFile
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
				"user_2020_07": {FileName: "testfile", Payload: nil, DataSchema: &Table{Name: "user_2020_07",
					Columns: Columns{
						"_geo_data_region": Column{Type: STRING},
						"_timestamp":       Column{Type: STRING},
						"event_type":       Column{Type: STRING},
						"key1":             Column{Type: STRING},
						"key3":             Column{Type: STRING}}},
				},

				"user_2020_08": {FileName: "testfile", Payload: nil, DataSchema: &Table{Name: "user_2020_08", Columns: Columns{
					"_geo_data_city":    Column{Type: STRING},
					"_geo_data_country": Column{Type: STRING},
					"_geo_data_zip":     Column{Type: STRING},
					"_timestamp":        Column{Type: STRING},
					"event_type":        Column{Type: STRING},
					"key1":              Column{Type: STRING},
					"key10":             Column{Type: STRING},
					"key10_sib1_1":      Column{Type: STRING},
					"key1_key2":         Column{Type: STRING},
					"key3":              Column{Type: STRING}}},
				},

				"notification_2020_08": {FileName: "testfile", Payload: nil, DataSchema: &Table{Name: "notification_2020_08", Columns: Columns{
					"_geo_data_latitude":  Column{Type: STRING},
					"_geo_data_longitude": Column{Type: STRING},
					"_timestamp":          Column{Type: STRING},
					"event_type":          Column{Type: STRING},
					"key1_key2":           Column{Type: STRING},
					"key5":                Column{Type: STRING},
					"key3":                Column{Type: STRING}}},
				},
			},
		},
	}
	p, err := NewProcessor(`{{.event_type}}_{{._timestamp.Format "2006_01"}}`, []string{})
	require.NoError(t, err)
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			fBytes, err := ioutil.ReadFile(tt.inputFilePath)
			require.NoError(t, err)

			actualResult, err := p.Process("testfile", fBytes, false)
			require.NoError(t, err)

			require.Equal(t, len(tt.expectedResult), len(actualResult), "Result sizes aren't equal")

			//assert equal one by one
			for k, expectedValue := range tt.expectedResult {
				b, err := ioutil.ReadFile("../test_data/" + k)
				require.NoError(t, err)
				expectedValue.Payload = bytes.NewBuffer(b)

				actualValue, ok := actualResult[k]
				require.True(t, ok, "Expected key isn't in actual result: %s", k)

				require.Equal(t, expectedValue.FileName, actualValue.FileName, "File names aren't equal: %s", k)
				test.ObjectsEqual(t, expectedValue.DataSchema, actualValue.DataSchema, "DataSchemas aren't equal: %s", k)

				//assert equal payload line by line
				expected := strings.Split(expectedValue.Payload.String(), "\n")
				actual := strings.Split(actualValue.Payload.String(), "\n")
				require.Equal(t, len(expected), len(actual), "Payload sizes aren't equal: %s expected: %s actual: %s", k, expectedValue.Payload.String(), actualValue.Payload.String())
				for i, e := range expected {
					test.JsonBytesEqual(t, []byte(e), []byte(actual[i]), "Lines in Payloads aren't equal: %s", k)
				}
			}
		})
	}
}
