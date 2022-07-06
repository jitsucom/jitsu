package schema

import (
	"encoding/json"
	"fmt"
	"reflect"
	"strings"
)

type Flattener interface {
	FlattenObject(map[string]interface{}) (map[string]interface{}, error)
}

type FlattenerImpl struct {
	omitNilValues bool
}

func NewFlattener() Flattener {
	return &FlattenerImpl{
		omitNilValues: true,
	}
}

//FlattenObject flatten object e.g. from {"key1":{"key2":123}} to {"key1_key2":123}
//from {"$key1":1} to {"_key1":1}
//from {"(key1)":1} to {"_key1_":1}
func (f *FlattenerImpl) FlattenObject(json map[string]interface{}) (map[string]interface{}, error) {
	flattenMap := make(map[string]interface{})

	err := f.flatten("", json, flattenMap)
	if err != nil {
		return nil, err
	}
	emptyKeyValue, hasEmptyKey := flattenMap[""]
	if hasEmptyKey {
		flattenMap["_unnamed"] = emptyKeyValue
		delete(flattenMap, "")
	}
	return flattenMap, nil
}

//recursive function for flatten key (if value is inner object -> recursion call)
//Reformat key
func (f *FlattenerImpl) flatten(key string, value interface{}, destination map[string]interface{}) error {
	key = Reformat(key)
	t := reflect.ValueOf(value)
	switch t.Kind() {
	case reflect.Slice:
		if strings.Contains(key, SqlTypeKeyword) {
			//meta field. value must be left untouched.
			destination[key] = value
			return nil
		}
		b, err := json.Marshal(value)
		if err != nil {
			return fmt.Errorf("Error marshaling array with key %s: %v", key, err)
		}
		destination[key] = string(b)
	case reflect.Map:
		unboxed := value.(map[string]interface{})
		for k, v := range unboxed {
			newKey := k
			if key != "" {
				newKey = key + "_" + newKey
			}
			if err := f.flatten(newKey, v, destination); err != nil {
				return err
			}
		}
	case reflect.Bool:
		boolValue, _ := value.(bool)
		destination[key] = boolValue
	default:
		if !f.omitNilValues || value != nil {
			switch value.(type) {
			case string:
				strValue, _ := value.(string)

				destination[key] = strValue
			default:
				destination[key] = value
			}
		}
	}

	return nil
}

//Reformat makes all keys to lower case and replaces all special symbols with '_'
func Reformat(key string) string {
	key = strings.ToLower(key)
	var result strings.Builder
	for _, symbol := range key {
		if IsLetterOrNumber(symbol) {
			result.WriteByte(byte(symbol))
		} else {
			result.WriteRune('_')
		}
	}
	return result.String()
}

//IsLetterOrNumber returns true if input symbol is:
//  A - Z: 65-90
//  a - z: 97-122
func IsLetterOrNumber(symbol int32) bool {
	return ('a' <= symbol && symbol <= 'z') ||
		('A' <= symbol && symbol <= 'Z') ||
		('0' <= symbol && symbol <= '9')
}
