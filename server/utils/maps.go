package utils

import (
	"fmt"
)

func StringMapPutAll(destination map[string]string, source map[string]string) {
	for k, v := range source {
		destination[k] = v
	}
}

func MapPutAll(destination map[string]interface{}, source map[string]interface{}) {
	for k, v := range source {
		destination[k] = v
	}
}

// MapPutIfAbsent puts value into map if key doesn't exist. Returns true if value was put
func MapPutIfAbsent(mp map[string]string, key string, value string) bool {
	if _, ok := mp[key]; !ok {
		mp[key] = value
		return true
	}
	return false
}

// MapNestedKeysToString recursively traverses passed map and converts all nested map[interface{}]interface{} objects to map[string]interface{}
// that may be necessary for json marshalling of objects extracted from yaml
func MapNestedKeysToString(m map[string]interface{}) map[string]interface{} {
	for k, v := range m {
		m[k] = MapKeysToString(v)
	}
	return m
}

// MapKeysToString recursively traverses passed object if it is map or slice and converts all map[interface{}]interface{} objects to map[string]interface{}
// that may be necessary for json marshalling of objects extracted from yaml
func MapKeysToString(v interface{}) interface{} {
	switch value := v.(type) {
	case map[string]interface{}:
		for k, vv := range value {
			value[k] = MapKeysToString(vv)
		}
		return value
	case map[interface{}]interface{}:
		result := make(map[string]interface{}, len(value))
		for k, vv := range value {
			result[fmt.Sprint(k)] = MapKeysToString(vv)
		}
		return result
	case []interface{}:
		for i, av := range value {
			value[i] = MapKeysToString(av)
		}
		return value
	}
	return v
}
