package schema

import (
	"github.com/ksensehq/eventnative/test"
	"github.com/stretchr/testify/require"
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
				},
				"key10": true,
			},
			map[string]interface{}{"key1": "value1", "key2": 2, "key4": "[]", "key5": "[1,2,3,4]", "key7": "[1,0.8884213]", "key8_sub_key1": "event",
				"key8_sub_key2": 123123.3123, "key8_sub_key3_sub_sub_key1": "[\"1,\",\"2.\"]", "key10": "true"},
		},
	}
	flattener := NewFlattener()
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			actualFlattenJson, err := flattener.FlattenObject(tt.inputJson)
			require.NoError(t, err)
			test.ObjectsEqual(t, tt.expectedJson, actualFlattenJson, "Wrong flattened json")
		})
	}
}
