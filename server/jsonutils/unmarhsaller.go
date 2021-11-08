package jsonutils

import (
	"encoding/json"
	"fmt"
)

//UnmarshalConfig serializes and deserializes config into the object
//return error if occurred
func UnmarshalConfig(config interface{}, object interface{}) error {
	b, err := json.Marshal(config)
	if err != nil {
		return fmt.Errorf("error marshalling object: %v", err)
	}
	err = json.Unmarshal(b, object)
	if err != nil {
		return fmt.Errorf("Error unmarshalling config: %v", err)
	}

	return nil
}
