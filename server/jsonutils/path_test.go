package jsonutils

import (
	"github.com/jitsucom/jitsu/server/test"
	"github.com/stretchr/testify/require"
	"testing"
)

func TestGet(t *testing.T) {
	tests := []struct {
		name              string
		path              string
		inputObject       map[string]interface{}
		expectedValue     interface{}
		expectedExistence bool
	}{
		{
			"nil",
			"",
			nil,
			nil,
			false,
		},
		{
			"Empty",
			"",
			map[string]interface{}{},
			nil,
			false,
		},
		{
			"key doesn't exist",
			"/key0",
			map[string]interface{}{
				"key1": map[string]interface{}{
					"subkey1": 123,
				},
				"key2": "value",
			},
			nil,
			false,
		},
		{
			"Key exists object",
			"/key1/subkey1",
			map[string]interface{}{
				"key1": map[string]interface{}{
					"subkey1": map[string]interface{}{
						"subsubkey1": 123,
						"subsubkey2": 123,
					},
				},
			},
			map[string]interface{}{
				"subsubkey1": 123,
				"subsubkey2": 123,
			},
			true,
		},
		{
			"Key exists not object",
			"key1/subkey1/subsubkey1/",
			map[string]interface{}{
				"key1": map[string]interface{}{
					"subkey1": map[string]interface{}{
						"subsubkey1": 123,
						"subsubkey2": 123,
					},
				},
			},
			123,
			true,
		},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			jp := NewJsonPath(tt.path)

			actualValue, ok := jp.Get(tt.inputObject)
			require.Equal(t, tt.expectedExistence, ok)

			test.ObjectsEqual(t, tt.expectedValue, actualValue, "Values aren't equal")
		})
	}
}

func TestGetAndRemove(t *testing.T) {
	tests := []struct {
		name                       string
		path                       string
		inputObject                map[string]interface{}
		expectedValue              interface{}
		expectedExistence          bool
		expectedChangedInputObject map[string]interface{}
	}{
		{
			"nil",
			"",
			nil,
			nil,
			false,
			nil,
		},
		{
			"Empty",
			"",
			map[string]interface{}{},
			nil,
			false,
			map[string]interface{}{},
		},
		{
			"key doesn't exist",
			"/key0",
			map[string]interface{}{
				"key1": map[string]interface{}{
					"subkey1": 123,
				},
				"key2": "value",
			},
			nil,
			false,
			map[string]interface{}{
				"key1": map[string]interface{}{
					"subkey1": 123,
				},
				"key2": "value",
			},
		},
		{
			"Key exists object",
			"/key1/subkey1",
			map[string]interface{}{
				"key1": map[string]interface{}{
					"subkey1": map[string]interface{}{
						"subsubkey1": 123,
						"subsubkey2": 123,
					},
				},
			},
			map[string]interface{}{
				"subsubkey1": 123,
				"subsubkey2": 123,
			},
			true,
			map[string]interface{}{
				"key1": map[string]interface{}{},
			},
		},
		{
			"Key exists not object",
			"/key1/subkey1/subsubkey1",
			map[string]interface{}{
				"key1": map[string]interface{}{
					"subkey1": map[string]interface{}{
						"subsubkey1": 123,
						"subsubkey2": 123,
					},
				},
			},
			123,
			true,
			map[string]interface{}{
				"key1": map[string]interface{}{
					"subkey1": map[string]interface{}{
						"subsubkey2": 123,
					},
				},
			},
		},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			jp := NewJsonPath(tt.path)

			actualValue, ok := jp.GetAndRemove(tt.inputObject)
			require.Equal(t, tt.expectedExistence, ok)

			test.ObjectsEqual(t, tt.expectedValue, actualValue, "Values aren't equal")
			test.ObjectsEqual(t, tt.expectedChangedInputObject, tt.inputObject, "Input object and changed one aren't equal")
		})
	}
}

func TestSet(t *testing.T) {
	tests := []struct {
		name           string
		path           string
		inputObject    map[string]interface{}
		inputValue     interface{}
		expectedObject map[string]interface{}
		expectedErr    string
	}{
		{
			"nil",
			"abc",
			nil,
			nil,
			nil,
			"",
		},
		{
			"Empty",
			"",
			map[string]interface{}{},
			1,
			map[string]interface{}{},
			"",
		},
		{
			"set object",
			"/key0",
			map[string]interface{}{
				"key1": map[string]interface{}{
					"subkey1": 123,
				},
			},
			map[string]interface{}{
				"key2": map[string]interface{}{
					"subkey1": 123,
				},
			},
			map[string]interface{}{
				"key1": map[string]interface{}{
					"subkey1": 123,
				},
				"key0": map[string]interface{}{
					"key2": map[string]interface{}{
						"subkey1": 123,
					},
				},
			},
			"",
		},
		{
			"set overwrites value",
			"/key1/subkey1",
			map[string]interface{}{
				"key1": map[string]interface{}{
					"subkey1": map[string]interface{}{
						"subsubkey1": 123,
						"subsubkey2": 123,
					},
				},
			},
			124,
			map[string]interface{}{
				"key1": map[string]interface{}{
					"subkey1": 124,
				},
			},
			"",
		},
		{
			"set wasn't ok",
			"/key1/subkey1",
			map[string]interface{}{
				"key1": "value",
			},
			124,
			map[string]interface{}{
				"key1": "value",
			},
			"Value 124 wasn't set into /key1/subkey1: key1 node isn't an object",
		},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			jp := NewJsonPath(tt.path)

			err := jp.Set(tt.inputObject, tt.inputValue)
			if tt.expectedErr != "" {
				require.Error(t, err)
				require.Equal(t, tt.expectedErr, err.Error())
			} else {
				require.NoError(t, err)
				test.ObjectsEqual(t, tt.expectedObject, tt.inputObject, "Values aren't equal")
			}
		})
	}
}
