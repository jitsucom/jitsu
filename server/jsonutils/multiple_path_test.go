package jsonutils

import (
	"testing"

	"github.com/jitsucom/jitsu/server/test"
	"github.com/stretchr/testify/require"
)

func TestMultipleGet(t *testing.T) {
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
			"/key0||/key2",
			map[string]interface{}{
				"key1": map[string]interface{}{
					"subkey1": 123,
				},
				"key3": "value",
			},
			nil,
			false,
		},
		{
			"First Key exists",
			"/key1/subkey1||/key1/key2",
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
			"Second Key exists",
			"/key1/subkey1||/key1/key2",
			map[string]interface{}{
				"key1": map[string]interface{}{
					"key2": map[string]interface{}{
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
			"Both Keys exist",
			"key1/subkey1||key2",
			map[string]interface{}{
				"key1": map[string]interface{}{
					"subkey1": map[string]interface{}{
						"subsubkey1": 123,
						"subsubkey2": 123,
					},
				},
				"key2": []string{"aaa"},
			},
			map[string]interface{}{
				"subsubkey1": 123,
				"subsubkey2": 123,
			},
			true,
		},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			jp := NewJSONPath(tt.path)

			actualValue, ok := jp.Get(tt.inputObject)
			require.Equal(t, tt.expectedExistence, ok)

			test.ObjectsEqual(t, tt.expectedValue, actualValue, "Values aren't equal")
		})
	}
}

func TestMultipleGetAndRemove(t *testing.T) {
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
			"/key0||/key3",
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
			"First key exists",
			"/key1/subkey1||/key2",
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
			"Second Key exists",
			"/key2||/key1/subkey1/subsubkey1",
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
		{
			"Both Keys exist",
			"/key1/subkey1/subsubkey1||/key2",
			map[string]interface{}{
				"key1": map[string]interface{}{
					"subkey1": map[string]interface{}{
						"subsubkey1": 123,
						"subsubkey2": 123,
					},
				},
				"key2": 1234,
			},
			123,
			true,
			map[string]interface{}{
				"key1": map[string]interface{}{
					"subkey1": map[string]interface{}{
						"subsubkey2": 123,
					},
				},
				"key2": 1234,
			},
		},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			jp := NewJSONPath(tt.path)

			actualValue, ok := jp.GetAndRemove(tt.inputObject)
			require.Equal(t, tt.expectedExistence, ok)

			test.ObjectsEqual(t, tt.expectedValue, actualValue, "Values aren't equal")
			test.ObjectsEqual(t, tt.expectedChangedInputObject, tt.inputObject, "Input object and changed one aren't equal")
		})
	}
}

func TestMultipleSet(t *testing.T) {
	tests := []struct {
		name           string
		path           string
		inputObject    map[string]interface{}
		inputValue     interface{}
		innerCreation  bool
		expectedObject map[string]interface{}
		expectedErr    string
	}{
		{
			"nil",
			"abc",
			nil,
			nil,
			false,
			nil,
			"",
		},
		{
			"Empty",
			"",
			map[string]interface{}{},
			1,
			false,
			map[string]interface{}{},
			"",
		},
		{
			"set object",
			"/key0||/key10",
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
			false,
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
			"/key1/subkey1||/key2",
			map[string]interface{}{
				"key1": map[string]interface{}{
					"subkey1": map[string]interface{}{
						"subsubkey1": 123,
						"subsubkey2": 123,
					},
				},
			},
			124,
			false,
			map[string]interface{}{
				"key1": map[string]interface{}{
					"subkey1": 124,
				},
			},
			"",
		},
		{
			"First set not ok : second ok",
			"/key1/subkey1||/key2",
			map[string]interface{}{
				"key1": "value",
			},
			500,
			false,
			map[string]interface{}{
				"key1": "value",
				"key2": 124,
			},
			"Value 500 wasn't set into /key1/subkey1: key1 node isn't an object",
		},
		{
			"First set not ok : second ok",
			"/key1/subkey1/subkey3||/key2",
			map[string]interface{}{
				"key1": map[string]interface{}{
					"subkey2": map[string]interface{}{},
				},
			},
			124,
			false,
			map[string]interface{}{
				"key1": map[string]interface{}{
					"subkey2": map[string]interface{}{},
				},
				"key2": 124,
			},
			"",
		},
		{
			"both exist: first ok",
			"/key1/subkey2||/key2/key3",
			map[string]interface{}{
				"key1": map[string]interface{}{
					"subkey1": 123,
				},
				"key2": map[string]interface{}{},
			},
			1,
			false,
			map[string]interface{}{
				"key1": map[string]interface{}{
					"subkey1": 123,
					"subkey2": 1,
				},
				"key2": map[string]interface{}{},
			},
			"",
		},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			jp := NewJSONPath(tt.path)

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

func TestMultipleSetIfNotExist(t *testing.T) {
	tests := []struct {
		name           string
		path           string
		inputObject    map[string]interface{}
		inputValue     interface{}
		expectedObject map[string]interface{}
	}{
		{
			"nil",
			"abc",
			nil,
			nil,
			nil,
		},
		{
			"Empty",
			"",
			map[string]interface{}{},
			1,
			map[string]interface{}{},
		},
		{
			"set object",
			"/key0||/key10",
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
		},
		{
			"set doesn't overwrite value",
			"/key1/subkey1||/key2",
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
					"subkey1": map[string]interface{}{
						"subsubkey1": 123,
						"subsubkey2": 123,
					},
				},
			},
		},
		{
			"First set not ok : second exists",
			"/key1/subkey1||/key2",
			map[string]interface{}{
				"key1": "value",
				"key2": 123,
			},
			500,
			map[string]interface{}{
				"key1": "value",
				"key2": 123,
			},
		},
		{
			"First set not ok : second ok",
			"/key1/subkey1/subkey3||/key2",
			map[string]interface{}{
				"key1": map[string]interface{}{
					"subkey2": map[string]interface{}{},
				},
			},
			124,
			map[string]interface{}{
				"key1": map[string]interface{}{
					"subkey2": map[string]interface{}{},
				},
				"key2": 124,
			},
		},
		{
			"both exist: first ok",
			"/key1/subkey2||/key2/key3",
			map[string]interface{}{
				"key1": map[string]interface{}{
					"subkey1": 123,
				},
				"key2": map[string]interface{}{},
			},
			1,
			map[string]interface{}{
				"key1": map[string]interface{}{
					"subkey1": 123,
					"subkey2": 1,
				},
				"key2": map[string]interface{}{},
			},
		},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			jp := NewJSONPath(tt.path)

			err := jp.SetIfNotExist(tt.inputObject, tt.inputValue)
			require.NoError(t, err)
			test.ObjectsEqual(t, tt.expectedObject, tt.inputObject, "Values aren't equal")
		})
	}
}

func TestMultipleSetOrMergeIfExist(t *testing.T) {
	tests := []struct {
		name           string
		path           string
		inputObject    map[string]interface{}
		inputValue     map[string]interface{}
		expectedObject map[string]interface{}
	}{
		{
			"nil",
			"abc",
			nil,
			nil,
			nil,
		},
		{
			"Empty",
			"",
			map[string]interface{}{},
			map[string]interface{}{"key": "value"},
			map[string]interface{}{},
		},
		{
			"set object",
			"/key0||/key10",
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
		},
		{
			"set or merge do merge values",
			"/key1/subkey1||/key2",
			map[string]interface{}{
				"key1": map[string]interface{}{
					"subkey1": map[string]interface{}{
						"subsubkey1": 123,
						"subsubkey2": 123,
					},
				},
			},
			map[string]interface{}{
				"subkey1": "subvalue1",
				"subkey2": "subvalue2",
			},
			map[string]interface{}{
				"key1": map[string]interface{}{
					"subkey1": map[string]interface{}{
						"subkey1":    "subvalue1",
						"subkey2":    "subvalue2",
						"subsubkey1": 123,
						"subsubkey2": 123,
					},
				},
			},
		},
		{
			"set or merge do merge values but does not override",
			"/key1/subkey1||/key2",
			map[string]interface{}{
				"key1": map[string]interface{}{
					"subkey1": map[string]interface{}{
						"subsubkey1": 123,
						"subsubkey2": 123,
					},
				},
			},
			map[string]interface{}{
				"subsubkey1": "subvalue1",
				"subsubkey2": "subvalue2",
			},
			map[string]interface{}{
				"key1": map[string]interface{}{
					"subkey1": map[string]interface{}{
						"subsubkey1": 123,
						"subsubkey2": 123,
					},
				},
			},
		},
		{
			"First set not ok : second exists",
			"/key1/subkey1||/key2",
			map[string]interface{}{
				"key1": "value",
				"key2": 123,
			},
			map[string]interface{}{
				"subkey1": "subvalue1",
				"subkey2": "subvalue2",
			},
			map[string]interface{}{
				"key1": "value",
				"key2": 123,
			},
		},
		{
			"First set not ok : second ok",
			"/key1/subkey1/subkey3||/key2",
			map[string]interface{}{
				"key1": map[string]interface{}{
					"subkey2": map[string]interface{}{},
				},
			},
			map[string]interface{}{
				"subkey1": "subvalue1",
				"subkey2": "subvalue2",
			},
			map[string]interface{}{
				"key1": map[string]interface{}{
					"subkey2": map[string]interface{}{},
				},
				"key2": map[string]interface{}{
					"subkey1": "subvalue1",
					"subkey2": "subvalue2",
				},
			},
		},
		{
			"both exist: first ok",
			"/key1/subkey2||/key2/key3",
			map[string]interface{}{
				"key1": map[string]interface{}{
					"subkey1": 123,
				},
				"key2": map[string]interface{}{},
			},
			map[string]interface{}{
				"subkey1": "subvalue1",
				"subkey2": "subvalue2",
			},
			map[string]interface{}{
				"key1": map[string]interface{}{
					"subkey1": 123,
					"subkey2": map[string]interface{}{
						"subkey1": "subvalue1",
						"subkey2": "subvalue2",
					},
				},
				"key2": map[string]interface{}{},
			},
		},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			jp := NewJSONPath(tt.path)

			err := jp.SetOrMergeIfExist(tt.inputObject, tt.inputValue)
			require.NoError(t, err)
			test.ObjectsEqual(t, tt.expectedObject, tt.inputObject, "Values aren't equal")
		})
	}
}
