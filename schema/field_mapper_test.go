package schema

import (
	"github.com/ksensehq/eventnative/test"
	"github.com/stretchr/testify/require"
	"testing"
)

func TestApplyDelete(t *testing.T) {
	tests := []struct {
		name           string
		mappings       []string
		inputObject    map[string]interface{}
		expectedObject map[string]interface{}
	}{
		{
			"nil input object",
			nil,
			nil,
			nil,
		},
		{
			"Empty mappings and input object",
			nil,
			map[string]interface{}{},
			map[string]interface{}{},
		},
		{
			"Dummy mapper doesn't change input json",
			nil,
			map[string]interface{}{
				"key1": map[string]interface{}{
					"subkey1": 123,
				},
				"key2": "value",
			},
			map[string]interface{}{
				"key1": map[string]interface{}{
					"subkey1": 123,
				},
				"key2": "value",
			},
		},
		{
			"Remove ok",
			[]string{"key0 ->", "/key3 ->   ", "/key4/subkey2/subsubkey1/ ->"},
			map[string]interface{}{
				"key0": 123,
				"key1": map[string]interface{}{
					"subkey1": 123,
				},
				"key2": "value",
				"key3": map[string]interface{}{
					"subkey2": "kk",
					"subkey3": map[string]interface{}{
						"subsubkey1": 123,
					},
				},
				"key4": map[string]interface{}{
					"subkey1": 123,
					"subkey2": map[string]interface{}{
						"subsubkey1": map[string]interface{}{
							"subsubsubkey1": 123,
						},
					},
				},
			},
			map[string]interface{}{
				"key1": map[string]interface{}{
					"subkey1": 123,
				},
				"key2": "value",
				"key4": map[string]interface{}{
					"subkey1": 123,
					"subkey2": map[string]interface{}{},
				},
			},
		},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			mapper, _, err := NewFieldMapper(tt.mappings)
			require.NoError(t, err)

			actualObject := mapper.ApplyDelete(tt.inputObject)
			test.ObjectsEqual(t, tt.expectedObject, actualObject, "Objects aren't equal")
		})
	}
}

func TestMap(t *testing.T) {
	tests := []struct {
		name           string
		mappings       []string
		inputObject    map[string]interface{}
		expectedObject map[string]interface{}
	}{
		{
			"nil input object",
			nil,
			nil,
			nil,
		},
		{
			"Empty mappings and input object",
			nil,
			map[string]interface{}{},
			map[string]interface{}{},
		},
		{
			"Dummy mapper doesn't change input json",
			nil,
			map[string]interface{}{
				"key1": map[string]interface{}{
					"subkey1": 123,
				},
				"key2": "value",
			},
			map[string]interface{}{
				"key1": map[string]interface{}{
					"subkey1": 123,
				},
				"key2": "value",
			},
		},
		{
			"Map unflatten object",
			[]string{"/key1 -> /key10", "/key2/subkey2-> /key11"},
			map[string]interface{}{
				"key1": map[string]interface{}{
					"subkey1": 123,
				},
				"key2": "value",
				"key3": 999,
			},
			map[string]interface{}{
				"key10": map[string]interface{}{
					"subkey1": 123,
				},
				"key2": "value",
				"key3": 999,
			},
		},
		{
			"Map flatten object",
			[]string{"/key1 -> /key10", "/key1/key2-> /key11"},
			map[string]interface{}{
				"key1":           "123",
				"key1_key2":      123,
				"key1_key2_key3": "value",
				"key3":           999,
			},
			map[string]interface{}{
				"key10":          "123",
				"key11":          123,
				"key1_key2_key3": "value",
				"key3":           999,
			},
		},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			mapper, _, err := NewFieldMapper(tt.mappings)
			require.NoError(t, err)

			actualObject, _ := mapper.Map(tt.inputObject)
			test.ObjectsEqual(t, tt.expectedObject, actualObject, "Mapped objects aren't equal")
		})
	}
}
