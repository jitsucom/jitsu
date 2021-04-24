package jsonutils

import (
	"testing"

	"github.com/stretchr/testify/require"
)

func TestNewPathes(t *testing.T) {
	var configuration []string = nil
	value := NewJSONPathes(configuration)
	require.NotNil(t, value)
	require.Empty(t, value.pathes)

	configuration = []string{"key/subkey"}
	value = NewJSONPathes(configuration)
	require.NotNil(t, value)
	require.NotEmpty(t, value.pathes)
	require.Contains(t, value.pathes, "key/subkey")
	require.Len(t, value.pathes, 1)

	configuration = []string{"key1", "key2", "key3", "key2", "key1"}
	value = NewJSONPathes(configuration)
	require.NotNil(t, value)
	require.NotEmpty(t, value.pathes)
	require.Contains(t, value.pathes, "key1")
	require.Contains(t, value.pathes, "key2")
	require.Contains(t, value.pathes, "key3")
	require.Len(t, value.pathes, 3)
}

func TestGetPathes(t *testing.T) {
	var configuration []string = nil

	event := map[string]interface{}{
		"key1": 7,
		"key2": true,
		"key3": "value",
	}

	pathes := NewJSONPathes(configuration)
	object, result := pathes.Get(event)
	require.False(t, result)
	require.NotNil(t, object)

	configuration = []string{"key/subkey"}
	pathes = NewJSONPathes(configuration)
	object, result = pathes.Get(event)
	require.False(t, result)
	require.NotNil(t, object)
	require.NotEmpty(t, object)
	require.Contains(t, object, "key/subkey")
	require.Nil(t, object["key1/subkey"])

	configuration = []string{"key1", "key2", "key3"}
	pathes = NewJSONPathes(configuration)
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

func TestSetPathes(t *testing.T) {
	var configuration []string = nil

	event := map[string]interface{}{
		"key1": 7,
	}

	values := map[string]interface{}{
		"key1": 42,
		"key2": "value",
		"key3": true,
	}

	pathes := NewJSONPathes(configuration)
	err := pathes.Set(event, values)
	require.Nil(t, err)
	require.Equal(t, 7, event["key1"])
	require.Equal(t, nil, event["key2"])
	require.Equal(t, nil, event["key3"])

	configuration = []string{"key/subkey"}
	pathes = NewJSONPathes(configuration)
	err = pathes.Set(event, values)
	require.Nil(t, err)
	require.Equal(t, 7, event["key1"])
	require.Equal(t, nil, event["key2"])
	require.Equal(t, nil, event["key3"])

	configuration = []string{"key1", "key2", "key3"}
	pathes = NewJSONPathes(configuration)
	err = pathes.Set(event, values)
	require.Nil(t, err)
	require.Equal(t, 42, event["key1"])
	require.Equal(t, "value", event["key2"])
	require.Equal(t, true, event["key3"])
}
