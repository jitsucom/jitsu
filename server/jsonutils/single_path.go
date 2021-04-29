package jsonutils

import (
	"errors"
	"fmt"
	"strings"
)

var ErrNodeNotExist = errors.New("Inner node doesn't exist")

//SingleJSONPath is a struct for extracting and setting value by JSON path
type SingleJSONPath struct {
	//[key1, key2, key3]
	parts []string
}

//NewSingleJSONPath return Single JSONPath (Single or Multiple)
func NewSingleJSONPath(path string) *SingleJSONPath {
	formatted := strings.ReplaceAll(formatPrefixSuffix(path), " ", "")
	parts := strings.Split(formatted, "/")
	if len(parts) == 1 && parts[0] == "" {
		//empty json path
		parts = []string{}
	}
	return &SingleJSONPath{parts: parts}
}

//IsEmpty returns true if path is empty
func (jp *SingleJSONPath) IsEmpty() bool {
	return len(jp.parts) == 0
}

//Get returns value of json path
func (jp *SingleJSONPath) Get(obj map[string]interface{}) (interface{}, bool) {
	return jp.getAndRemove(obj, false)
}

//GetAndRemove returns value of json path and remove it from origin json
func (jp *SingleJSONPath) GetAndRemove(obj map[string]interface{}) (interface{}, bool) {
	return jp.getAndRemove(obj, true)
}

func (jp *SingleJSONPath) getAndRemove(obj map[string]interface{}, remove bool) (interface{}, bool) {
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

//Set put value to json path with creating inner objects
//assume that obj can't be nil
//return err if value wasn't set
func (jp *SingleJSONPath) Set(obj map[string]interface{}, value interface{}) error {
	return jp.setWithInnerCreation(obj, value, true)
}

//setWithInnerCreation puts value to json path (can create intermediate objects layers)
//returns err if value wasn't set
func (jp *SingleJSONPath) setWithInnerCreation(obj map[string]interface{}, value interface{}, createInnerObjects bool) error {
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
		} else if createInnerObjects {
			subMap := map[string]interface{}{}
			obj[key] = subMap
			obj = subMap
		} else {
			return ErrNodeNotExist
		}
	}

	return nil
}

//String returns string representation of JSON path (/key1/key2)
func (jp *SingleJSONPath) String() string {
	return "/" + strings.Join(jp.parts, "/")
}

//FieldName returns string representation of flat field (key1_key2)
func (jp *SingleJSONPath) FieldName() string {
	return strings.Join(jp.parts, "_")
}
