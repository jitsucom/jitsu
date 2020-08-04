package schema

import (
	"github.com/ksensehq/tracker/test"
	"github.com/stretchr/testify/require"
	"testing"
)

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
			map[string]interface{}{"key1": map[string]interface{}{"subkey1": 123}, "key2": "value"},
			map[string]interface{}{"key1": map[string]interface{}{"subkey1": 123}, "key2": "value"},
		},
		{
			"Mapper output mapped fields and remove one",
			[]string{"/key1 -> /key10", "/key2/subkey2-> /key11", "/key3 ->   "},
			map[string]interface{}{"key1": map[string]interface{}{"subkey1": 123}, "key2": "value", "key3": 999},
			map[string]interface{}{"key10": map[string]interface{}{"subkey1": 123}, "key2": "value"},
		},
		{
			"Mapper remove all subkeys in deep object",
			[]string{"/key3 ->   "},
			map[string]interface{}{"key1": map[string]interface{}{"subkey1": 123}, "key2": "value", "key3": map[string]interface{}{"subkey2": "kk", "subkey3": map[string]interface{}{"subsubkey1": 123}}},
			map[string]interface{}{"key1": map[string]interface{}{"subkey1": 123}, "key2": "value"},
		},
		/*{ TODO
			"Mapper remove all subkeys in flat object",
			[]string{"/key3 ->   "},
			map[string]interface{}{"key1_subkey1": 123, "key2": "value", "key3_subkey2": "kk", "key3_subkey3_subsubkey1": 123},
			map[string]interface{}{"key1": map[string]interface{}{"subkey1": 123}, "key2": "value"},
		},*/
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			mapper, err := NewFieldMapper(tt.mappings)
			require.NoError(t, err)

			actualObject := mapper.Map(tt.inputObject)
			test.ObjectsEqual(t, tt.expectedObject, actualObject, "Mapped objects aren't equal")
		})
	}
}
