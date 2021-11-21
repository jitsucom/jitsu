package utils

import "fmt"

func ExtractObject(object interface{}, path ... string) (interface{}, error) {
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
