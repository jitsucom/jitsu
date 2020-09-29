package schema

import (
	"github.com/ksensehq/eventnative/logging"
	"github.com/ksensehq/eventnative/timestamp"
	"github.com/stretchr/testify/require"
	"testing"
	"time"
)

func TestJsonMarshal(t *testing.T) {
	testTime1, _ := time.Parse(timestamp.Layout, "2020-07-02T18:23:59.757719Z")
	tests := []struct {
		name      string
		inputJson map[string]interface{}
		expected  []byte
	}{
		{
			"Empty input json",
			map[string]interface{}{},
			[]byte("{}"),
		},
		{
			"Null pointer input json",
			nil,
			[]byte(`null`),
		},
		{
			"Different types json input",
			map[string]interface{}{
				"key1": "value1",
				"key2": 2,
				"key3": testTime1,
				"key4": nil,
				"key5": "",
				"key6": 222.5,
			},
			[]byte(`{"key1":"value1","key2":2,"key3":"2020-07-02T18:23:59.757719Z","key4":null,"key5":"","key6":222.5}`),
		},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			actualBytes, err := JsonMarshallerInstance.Marshal([]string{}, tt.inputJson)
			require.NoError(t, err)
			require.Equal(t, tt.expected, actualBytes, "Marshalled bytes aren't equal")
		})
	}
}

func TestCsvMarshal(t *testing.T) {
	testTime1, _ := time.Parse(timestamp.Layout, "2020-07-02T18:23:59.757719Z")
	tests := []struct {
		name        string
		inputJson   map[string]interface{}
		inputHeader []string
		expected    []byte
	}{
		{
			"Empty input json",
			map[string]interface{}{},
			[]string{},
			[]byte(nil),
		},
		{
			"Null pointer input json",
			nil,
			[]string{},
			[]byte(nil),
		},
		{
			"Different types json input",
			map[string]interface{}{
				"key1": "value1",
				"key2": 2,
				"key3": testTime1,
				"key5": "",
				"key6": 222.5,
			},
			[]string{"key6", "key2", "key3", "key4", "key5", "key1"},
			[]byte(`222.5||2||2020-07-02T18:23:59.757719Z||||||value1`),
		},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			actualBytes, err := CsvMarshallerInstance.Marshal(tt.inputHeader, tt.inputJson)
			logging.Info(string(actualBytes))
			require.NoError(t, err)
			require.Equal(t, tt.expected, actualBytes, "Marshalled bytes aren't equal")
		})
	}
}
