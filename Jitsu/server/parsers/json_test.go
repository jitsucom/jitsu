package parsers

import (
	"encoding/json"
	"github.com/jitsucom/jitsu/server/test"
	"github.com/stretchr/testify/require"
	"testing"
)

func TestParseJSON(t *testing.T) {
	tests := []struct {
		name        string
		input       []byte
		expected    map[string]interface{}
		expectedErr string
	}{
		{
			"Empty input array",
			[]byte{},
			map[string]interface{}{},
			"cannot unmarshal bytes into Go value of type map[string]interface {}: EOF",
		},
		{
			"Empty input object",
			[]byte("{}"),
			map[string]interface{}{},
			"",
		},
		{
			"Plain object",
			[]byte(`{"a":"123","b":"456","c":789}`),
			map[string]interface{}{"a": "123", "b": "456", "c": json.Number("789")},
			"",
		},
		{
			"Plain object with heading single bytes",
			append([]byte{0}, []byte(`{"a":"123","b":"456","c":789}`)...),
			map[string]interface{}{"a": "123", "b": "456", "c": json.Number("789")},
			"",
		},
		{
			"Plain object with heading empty bytes",
			append([]byte{0, 0, 0}, []byte(`{"a":"123","b":"456","c":789}`)...),
			map[string]interface{}{"a": "123", "b": "456", "c": json.Number("789")},
			"",
		},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			actual, err := ParseJSON(tt.input)
			if tt.expectedErr != "" {
				require.Error(t, err)
				require.Equal(t, tt.expectedErr, err.Error())
			} else {
				require.NoError(t, err)
				test.ObjectsEqual(t, tt.expected, actual, "Result objects aren't equal")
			}
		})
	}
}
