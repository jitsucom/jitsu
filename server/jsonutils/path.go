package jsonutils

import (
	"fmt"
	"strings"
)

//JSONPath is a struct for extracting and setting value by JSON path
type JSONPath struct {
	//[key1, key2, key3]
	parts []string
}

//NewJSONPath return JSONPath
func NewJSONPath(path string) *JSONPath {
	parts := strings.Split(formatPrefixSuffix(path), "/")
	if len(parts) == 1 && parts[0] == "" {
		//empty json path
		parts = []string{}
	}
	return &JSONPath{parts: parts}
}

//IsEmpty returns true if path is empty
func (jp *JSONPath) IsEmpty() bool {
	return len(jp.parts) == 0
}

//Get returns value of json path
func (jp *JSONPath) Get(obj map[string]interface{}) (interface{}, bool) {
	return jp.getAndRemove(obj, false)
}

//GetAndRemove returns value of json path and remove it from origin json
func (jp *JSONPath) GetAndRemove(obj map[string]interface{}) (interface{}, bool) {
	return jp.getAndRemove(obj, true)
}

func (jp *JSONPath) getAndRemove(obj map[string]interface{}, remove bool) (interface{}, bool) {
	//dive into obj and return last key
	for i := 0; i < len(jp.parts); i++ {
		key := jp.parts[i]
		if i == len(jp.parts)-1 {

			value, ok := obj[key]
			//source node doesn't exist
			if !ok {
				return nil, false
			}

			if remove {
				delete(obj, key)
			}

			return value, true
		}

		//dive
		if sub, ok := obj[key]; ok {
			if subMap, ok := sub.(map[string]interface{}); ok {
				obj = subMap
				continue
			}
		}
		break
	}

	return nil, false
}

//Set put value to json path
//assume that obj can't be nil
//return true if value was set
func (jp *JSONPath) Set(obj map[string]interface{}, value interface{}) error {
	if obj == nil {
		return nil
	}

	//dive into obj and put value to the last key
	for i := 0; i < len(jp.parts); i++ {
		key := jp.parts[i]
		if i == len(jp.parts)-1 {
			obj[key] = value
			return nil
		}

		//dive or create
		if sub, ok := obj[key]; ok {
			if subMap, ok := sub.(map[string]interface{}); ok {
				obj = subMap
			} else {
				//node isn't object node
				return fmt.Errorf("Value %d wasn't set into %s: %s node isn't an object", value, jp.String(), key)
			}
		} else {
			subMap := map[string]interface{}{}
			obj[key] = subMap
			obj = subMap
		}
	}

	return nil
}

//String returns string representation of JSON path (/key1/key2)
func (jp *JSONPath) String() string {
	return "/" + strings.Join(jp.parts, "/")
}

//FieldName returns string representation of flat field (key1_key2)
func (jp *JSONPath) FieldName() string {
	return strings.Join(jp.parts, "_")
}

func formatPrefixSuffix(key string) string {
	if strings.HasPrefix(key, "/") {
		key = key[1:]
	}
	if strings.HasSuffix(key, "/") {
		key = key[:len(key)-1]
	}
	return key
}
