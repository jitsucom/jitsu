package jsonutils

import (
	"fmt"
	"strings"
)

type JSONPath struct {
	//[key1, key2, key3]
	parts []string
}

//NewJSONPath return JSONPath
func NewJSONPath(path string) *JSONPath {
	parts := strings.Split(FormatPrefixSuffix(path), "/")
	if len(parts) == 1 && parts[0] == "" {
		//empty json path
		parts = []string{}
	}
	return &JSONPath{parts: parts}
}

func (jp *JSONPath) IsEmpty() bool {
	return len(jp.parts) == 0
}

//Get return value of json path
func (jp *JSONPath) Get(obj map[string]interface{}) (interface{}, bool) {
	return jp.getAndRemove(obj, false)
}

//Get return value of json path and remove it from origin json
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

func (jp *JSONPath) String() string {
	return "/" + strings.Join(jp.parts, "/")
}

func (jp *JSONPath) FieldName() string {
	return strings.Join(jp.parts, "_")
}

func FormatPrefixSuffix(key string) string {
	if strings.HasPrefix(key, "/") {
		key = key[1:]
	}
	if strings.HasSuffix(key, "/") {
		key = key[:len(key)-1]
	}
	return key
}

type JSONPathes struct {
	pathes map[string]*JSONPath
}

func NewJSONPathes(pathes []string) *JSONPathes {
	container := make(map[string]*JSONPath)

	for _, path := range pathes {
		container[path] = NewJSONPath(path)
	}

	return &JSONPathes{
		pathes: container,
	}
}

func (jpa *JSONPathes) String() string {
	result := ""

	for key := range jpa.pathes {
		if result != "" {
			result += ", "
		}
		result += key
	}

	return "[" + result + "]"
}

func (jpa *JSONPathes) Get(object map[string]interface{}) (map[string]interface{}, bool) {
	result := false
	array := make(map[string]interface{})

	for key, path := range jpa.pathes {
		value, answer := path.Get(object)
		array[key] = value
		result = result || answer
	}

	return array, result
}

func (jpa *JSONPathes) Set(object map[string]interface{}, values map[string]interface{}) error {
	for key, path := range jpa.pathes {
		value := values[key]
		if value != nil {
			err := path.Set(object, value)
			if err != nil {
				return err
			}
		}
	}

	return nil
}

func (jpa *JSONPathes) IsFullFilled(object map[string]interface{}) bool {
	result := true

	for _, path := range jpa.pathes {
		value, answer := path.Get(object)
		result = result && answer && value != nil

		if !result {
			return result
		}
	}

	return result
}
