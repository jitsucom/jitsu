package utils

import "fmt"

func ExtractObject(object interface{}, path ...string) (interface{}, error) {
	mp, ok := object.(map[string]interface{})
	if !ok {
		return nil, fmt.Errorf("Expected object of type map[string]interface{} got: %T", object)
	}
	last := len(path) == 1
	val, ok := mp[path[0]]
	if !last && (!ok || val == nil) {
		return nil, fmt.Errorf("Failed to reach end of the path. Left path: %s", path)
	}
	if last {
		return val, nil
	}
	return ExtractObject(val, path[1:]...)
}

// Nvl returns first not null object or pointer from varargs
//
// return nil if all passed arguments are nil
func Nvl(args ...interface{}) interface{} {
	for _, str := range args {
		if str != nil {
			return str
		}
	}
	return nil
}

func NvlInt(args ...int) int {
	for _, n := range args {
		if n != 0 {
			return n
		}
	}
	return 0
}

func NvlFloat(args ...float64) float64 {
	for _, n := range args {
		if n != 0 {
			return n
		}
	}
	return 0
}

// NvlMap returns first not empty map from varargs
//
// return nil if all passed maps are empty
func NvlMap(args ...map[string]interface{}) map[string]interface{} {
	for _, str := range args {
		if len(str) > 0 {
			return str
		}
	}
	return nil
}

// MapNVLKeys returns value by first key that exists or empty value of V type if no keys exist
func MapNVLKeys(mp map[string]interface{}, defaultValue interface{}, keys ...string) interface{} {
	for _, key := range keys {
		if value, ok := mp[key]; ok {
			return value
		}
	}
	return defaultValue
}
