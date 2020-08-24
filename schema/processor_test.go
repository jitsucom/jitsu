package schema

import (
	"github.com/ksensehq/eventnative/test"
	"github.com/ksensehq/eventnative/typing"
	"github.com/stretchr/testify/require"
	"io/ioutil"
	"log"
	"strings"
	"testing"
)

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
				"user_2020_07": {FileName: "testfile", payload: nil, DataSchema: &Table{Name: "user_2020_07",
					Columns: Columns{
						"_geo_data_region": Column{Type: typing.STRING},
						"_timestamp":       Column{Type: typing.TIMESTAMP},
						"event_type":       Column{Type: typing.STRING},
						"key1":             Column{Type: typing.FLOAT64},
						"key3":             Column{Type: typing.STRING}}},
				},

				"user_2020_08": {FileName: "testfile", payload: nil, DataSchema: &Table{Name: "user_2020_08", Columns: Columns{
					"_geo_data_city":    Column{Type: typing.STRING},
					"_geo_data_country": Column{Type: typing.STRING},
					"_geo_data_zip":     Column{Type: typing.STRING},
					"_timestamp":        Column{Type: typing.TIMESTAMP},
					"event_type":        Column{Type: typing.STRING},
					"key1":              Column{Type: typing.STRING},
					"key10":             Column{Type: typing.STRING},
					"key10_sib1_1":      Column{Type: typing.STRING},
					"key1_key2":         Column{Type: typing.STRING},
					"key3":              Column{Type: typing.STRING}}},
				},

				"notification_2020_08": {FileName: "testfile", payload: nil, DataSchema: &Table{Name: "notification_2020_08", Columns: Columns{
					"_geo_data_latitude":  Column{Type: typing.FLOAT64},
					"_geo_data_longitude": Column{Type: typing.FLOAT64},
					"_timestamp":          Column{Type: typing.TIMESTAMP},
					"event_type":          Column{Type: typing.STRING},
					"key1_key2":           Column{Type: typing.STRING},
					"key5":                Column{Type: typing.STRING},
					"key3":                Column{Type: typing.STRING}}},
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

			actualResult, err := p.ProcessFilePayload("testfile", fBytes, false)
			require.NoError(t, err)

			require.Equal(t, len(tt.expectedResult), len(actualResult), "Result sizes aren't equal")

			//assert equal one by one
			for k, expectedValue := range tt.expectedResult {
				expectedBytes, err := ioutil.ReadFile("../test_data/" + k)
				require.NoError(t, err)

				actualValue, ok := actualResult[k]
				actualBytes := actualValue.GetPayloadBytes()
				require.True(t, ok, "Expected key isn't in actual result: %s", k)

				require.Equal(t, expectedValue.FileName, actualValue.FileName, "File names aren't equal: %s", k)
				test.ObjectsEqual(t, expectedValue.DataSchema, actualValue.DataSchema, "DataSchemas aren't equal: %s", k)

				//assert equal payload line by line
				expected := strings.Split(string(expectedBytes), "\n")
				actual := strings.Split(string(actualBytes), "\n")
				require.Equal(t, len(expected), len(actual), "Payload sizes aren't equal: %s expected: %s actual: %s", k, string(expectedBytes), string(actualBytes))
				for i, e := range expected {
					log.Println(k)
					test.JsonBytesEqual(t, []byte(e), []byte(actual[i]), "Lines in Payloads aren't equal:", k)
				}
			}
		})
	}
}
