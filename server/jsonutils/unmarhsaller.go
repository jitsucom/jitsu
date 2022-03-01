package jsonutils

import (
	"encoding/json"
	"fmt"
)

//UnmarshalConfig serializes and deserializes config into the object
//return error if occurred
func UnmarshalConfig(config interface{}, object interface{}) error {
	reformatted := reformatInnerMaps(config)
	b, err := json.Marshal(reformatted)
	if err != nil {
		return fmt.Errorf("error marshalling object: %v", err)
	}
	err = json.Unmarshal(b, object)
	if err != nil {
		return fmt.Errorf("Error unmarshalling config: %v", err)
	}

	return nil
}

//reformatInnerMaps converts all map[interface{}]interface{} into map[string]interface{}
//because json.Marshal doesn't support map[interface{}]interface{} (supports only string keys)
//but viper produces map[interface{}]interface{} for inner maps
//return recursively converted all map[interface]interface{} to map[string]interface{}
func reformatInnerMaps(valueI interface{}) interface{} {
	switch value := valueI.(type) {
	case []interface{}:
		for i, subValue := range value {
			value[i] = reformatInnerMaps(subValue)
		}
		return value
	case map[interface{}]interface{}:
		newMap := make(map[string]interface{}, len(value))
		for k, subValue := range value {
			newMap[fmt.Sprint(k)] = reformatInnerMaps(subValue)
		}
		return newMap
	case map[string]interface{}:
		for k, subValue := range value {
			value[k] = reformatInnerMaps(subValue)
		}
		return value
	default:
		return valueI
	}
}
