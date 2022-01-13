package jsonutils

import (
	"testing"

	"github.com/stretchr/testify/require"
)

func TestNewPaths(t *testing.T) {
	var configuration []string = nil
	value := NewJSONPaths(configuration)
	require.NotNil(t, value)
	require.Empty(t, value.paths)

	configuration = []string{"key/subkey"}
	value = NewJSONPaths(configuration)
	require.NotNil(t, value)
	require.NotEmpty(t, value.paths)
	require.Contains(t, value.paths, "key/subkey")
	require.Len(t, value.paths, 1)

	configuration = []string{"key1", "key2", "key3", "key2", "key1"}
	value = NewJSONPaths(configuration)
	require.NotNil(t, value)
	require.NotEmpty(t, value.paths)
	require.Contains(t, value.paths, "key1")
	require.Contains(t, value.paths, "key2")
	require.Contains(t, value.paths, "key3")
	require.Len(t, value.paths, 3)
}

func TestGetPaths(t *testing.T) {
	var configuration []string = nil

	event := map[string]interface{}{
		"key1": 7,
		"key2": true,
		"key3": "value",
	}

	pathes := NewJSONPaths(configuration)
	object, result := pathes.Get(event)
	require.False(t, result)
	require.NotNil(t, object)

	configuration = []string{"key/subkey"}
	pathes = NewJSONPaths(configuration)
	object, result = pathes.Get(event)
	require.False(t, result)
	require.NotNil(t, object)
	require.NotEmpty(t, object)
	require.Contains(t, object, "key/subkey")
	require.Nil(t, object["key1/subkey"])

	configuration = []string{"key1", "key2", "key3"}
	pathes = NewJSONPaths(configuration)
	object, result = pathes.Get(event)
	require.True(t, result)
	require.NotNil(t, object)
	require.NotEmpty(t, object)
	require.Contains(t, object, "key1")
	require.Equal(t, 7, object["key1"])
	require.Contains(t, object, "key2")
	require.Equal(t, true, object["key2"])
	require.Contains(t, object, "key3")
	require.Equal(t, "value", object["key3"])
}

func TestSetPaths(t *testing.T) {
	var configuration []string = nil

	event := map[string]interface{}{
		"key1": 7,
		"key4": 10,
	}

	values := map[string]interface{}{
		"key1": 42,
		"key2": "value",
		"key3": true,
		"key4": nil,
	}

	pathes := NewJSONPaths(configuration)
	err := pathes.Set(event, values)
	require.Nil(t, err)
	require.Equal(t, 7, event["key1"])
	require.Equal(t, nil, event["key2"])
	require.Equal(t, nil, event["key3"])
	require.Equal(t, 10, event["key4"])

	configuration = []string{"key/subkey"}
	pathes = NewJSONPaths(configuration)
	err = pathes.Set(event, values)
	require.Nil(t, err)
	require.Equal(t, 7, event["key1"])
	require.Equal(t, nil, event["key2"])
	require.Equal(t, nil, event["key3"])
	require.Equal(t, 10, event["key4"])

	configuration = []string{"key1", "key2", "key3", "key4"}
	pathes = NewJSONPaths(configuration)
	err = pathes.Set(event, values)
	require.Nil(t, err)
	require.Equal(t, 42, event["key1"])
	require.Equal(t, "value", event["key2"])
	require.Equal(t, true, event["key3"])
	require.Equal(t, 10, event["key4"])
}
