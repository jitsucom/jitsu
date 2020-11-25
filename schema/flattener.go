package schema

import (
	"encoding/json"
	"fmt"
	"reflect"
	"strconv"
	"strings"
)

const maxStringLength = 8192

type Flattener struct {
	omitNilValues   bool
	toLowerCaseKeys bool

	specialCharsReplacer *strings.Replacer
}

func NewFlattener() *Flattener {
	return &Flattener{
		omitNilValues:   true,
		toLowerCaseKeys: true,
		specialCharsReplacer: strings.NewReplacer(
			"(", "_",
			")", "_",
			"$", "_",
			"[", "_",
			"]", "_",
			"{", "_",
			"}", "_",
			"@", "_",
			"!", "_",
			"#", "_",
			"%", "_",
			"&", "_",
			",", "_",
			".", "_",
			";", "_",
			":", "_",
			"^", "_",
			"-", "_",
		),
	}
}

//FlattenObject flatten object e.g. from {"key1":{"key2":123}} to {"key1_key2":123}
//from {"$key1":1} to {"_key1":1}
//from {"(key1)":1} to {"_key1_":1}
func (f *Flattener) FlattenObject(json map[string]interface{}) (map[string]interface{}, error) {
	flattenMap := make(map[string]interface{})

	err := f.flatten("", json, flattenMap)
	if err != nil {
		return nil, err
	}

	return flattenMap, nil

}

//recursive function for flatten key (if value is inner object -> recursion call)
//makes all keys to lower case
//remove $, (, ) from all keys
//cut strings to maxStringLength size
func (f *Flattener) flatten(key string, value interface{}, destination map[string]interface{}) error {
	if f.toLowerCaseKeys {
		key = strings.ToLower(key)
	}
	key = f.specialCharsReplacer.Replace(key)

	t := reflect.ValueOf(value)
	switch t.Kind() {
	case reflect.Slice:
		b, err := json.Marshal(value)
		if err != nil {
			return fmt.Errorf("Error marshaling array with key %s: %v", key, err)
		}
		destination[key] = limitLength(string(b))
	case reflect.Map:
		unboxed := value.(map[string]interface{})
		for k, v := range unboxed {
			newKey := k
			if key != "" {
				newKey = key + "_" + newKey
			}
			if err := f.flatten(newKey, v, destination); err != nil {
				return fmt.Errorf("Error flatten object with key %s_%s: %v", key, k, err)
			}
		}
	case reflect.Bool:
		destination[key] = strconv.FormatBool(value.(bool))
	default:
		if !f.omitNilValues || value != nil {
			switch value.(type) {
			case string:
				strValue, _ := value.(string)

				destination[key] = limitLength(strValue)
			default:
				destination[key] = value
			}
		}
	}

	return nil
}

func limitLength(value string) string {
	if len(value) > maxStringLength {
		return value[:maxStringLength]
	}

	return value
}
