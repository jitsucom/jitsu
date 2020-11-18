package jsonutils

import (
	"strings"
)

type JsonPath struct {
	//[key1, key2, key3]
	parts []string
}

//NewJsonPath return JsonPath
func NewJsonPath(path string) *JsonPath {
	parts := strings.Split(FormatPrefixSuffix(path), "/")
	if len(parts) == 1 && parts[0] == "" {
		//empty json path
		parts = []string{}
	}
	return &JsonPath{parts: parts}
}

func (jp *JsonPath) IsEmpty() bool {
	return len(jp.parts) == 0
}

//Get return value of json path
func (jp *JsonPath) Get(obj map[string]interface{}) (interface{}, bool) {
	return jp.getAndRemove(obj, false)
}

//Get return value of json path and remove it from origin json
func (jp *JsonPath) GetAndRemove(obj map[string]interface{}) (interface{}, bool) {
	return jp.getAndRemove(obj, true)
}

func (jp *JsonPath) getAndRemove(obj map[string]interface{}, remove bool) (interface{}, bool) {
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
func (jp *JsonPath) Set(obj map[string]interface{}, value interface{}) bool {
	if obj == nil {
		return false
	}

	//dive into obj and put value to the last key
	for i := 0; i < len(jp.parts); i++ {
		key := jp.parts[i]
		if i == len(jp.parts)-1 {
			obj[key] = value
			return true
		}

		//dive or create
		if sub, ok := obj[key]; ok {
			if subMap, ok := sub.(map[string]interface{}); ok {
				obj = subMap
			} else {
				//node isn't object node
				break
			}
		} else {
			subMap := map[string]interface{}{}
			obj[key] = subMap
			obj = subMap
		}
	}

	return false
}

func (jp *JsonPath) String() string {
	return "/" + strings.Join(jp.parts, "/")
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
