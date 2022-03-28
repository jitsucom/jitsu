package schema

import (
	"bytes"
	"github.com/jitsucom/jitsu/server/logging"
	"github.com/jitsucom/jitsu/server/timestamp"
	"github.com/stretchr/testify/require"
	"testing"
	"time"
)

func TestJSONMarshal(t *testing.T) {
	testTime1, _ := time.Parse(timestamp.Layout, "2020-07-02T18:23:59.757719Z")
	tests := []struct {
		name      string
		inputJSON map[string]interface{}
		expected  []byte
	}{
		{
			"Empty input json",
			map[string]interface{}{},
			[]byte("{}\n"),
		},
		{
			"Null pointer input json",
			nil,
			[]byte("null\n"),
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
			[]byte("{\"key1\":\"value1\",\"key2\":2,\"key3\":\"2020-07-02T18:23:59.757719Z\",\"key4\":null,\"key5\":\"\",\"key6\":222.5}\n"),
		},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			buf := &bytes.Buffer{}
			err := JSONMarshallerInstance.Marshal([]string{}, tt.inputJSON, buf)
			actualBytes := buf.Bytes()
			require.NoError(t, err)
			require.Equal(t, tt.expected, actualBytes, "Marshalled bytes aren't equal")
		})
	}
}

func TestCSVMarshal(t *testing.T) {
	testTime1, _ := time.Parse(timestamp.Layout, "2020-07-02T18:23:59.757719Z")
	tests := []struct {
		name        string
		inputJSON   map[string]interface{}
		inputHeader []string
		expected    []byte
	}{
		{
			"Empty input json",
			map[string]interface{}{},
			[]string{},
			[]byte("\n"),
		},
		{
			"Null pointer input json",
			nil,
			[]string{},
			[]byte("\n"),
		},
		{
			"Different types json input",
			map[string]interface{}{
				"key1": "value1",
				"key2": 2,
				"key3": testTime1,
				"key5": "",
				"key6": 222.5,
				"key7": "string with spaces",
				"key8": "string with spaces, and comma",
			},
			[]string{"key6", "key2", "key3", "key4", "key5", "key1", "key7", "key8"},
			[]byte("222.5,2,2020-07-02T18:23:59.757719Z,,,value1,string with spaces,\"string with spaces, and comma\"\n"),
		},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			buf := &bytes.Buffer{}
			err := CSVMarshallerInstance.Marshal(tt.inputHeader, tt.inputJSON, buf)
			actualBytes := buf.Bytes()
			logging.Info(string(actualBytes))
			require.NoError(t, err)
			require.Equal(t, tt.expected, actualBytes, "Marshalled bytes aren't equal")
		})
	}
}
