package parsers

import (
	"encoding/json"
	"errors"
	"fmt"
	"io/ioutil"
	"strings"
)

//ParseJSONAsFile parses value and write it to a json file
//returns path to created json file or return value if it is already path to json file
//or empty string if value is nil
func ParseJSONAsFile(newPath string, value interface{}) (string, error) {
	if value == nil {
		return "", nil
	}

	switch value.(type) {
	case map[string]interface{}:
		payload := value.(map[string]interface{})
		b, err := json.Marshal(payload)
		if err != nil {
			return "", fmt.Errorf("Malformed value: %v", err)
		}

		return newPath, ioutil.WriteFile(newPath, b, 0644)
	case string:
		payload := value.(string)
		if strings.HasPrefix(payload, "{") {
			return newPath, ioutil.WriteFile(newPath, []byte(payload), 0644)
		}

		//already file
		return payload, nil
	default:
		return "", errors.New("Unknown type. Value must be path to json file or raw json")
	}
}
