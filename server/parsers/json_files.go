package parsers

import (
	"encoding/json"
	"errors"
	"fmt"
	"io/ioutil"
	"strings"
)

var ErrValueIsNil = errors.New("value is nil")

//ParseJSONAsFile parses value and write it to a json file
//returns path to created json file or return value if it is already path to json file
//or empty string if value is nil
func ParseJSONAsFile(newPath string, value interface{}) (string, error) {
	if value == nil {
		return "", ErrValueIsNil
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
		valueString := value.(string)
		if strings.HasPrefix(valueString, "{") {
			return newPath, ioutil.WriteFile(newPath, []byte(valueString), 0644)
		}

		//check if it is valid json in the filepath
		content, err := ioutil.ReadFile(valueString)
		if err == nil && len(content) > 0 && strings.HasPrefix(string(content), "{") {
			testObj := map[string]interface{}{}
			if err := json.Unmarshal(content, &testObj); err != nil {
				return "", fmt.Errorf("value in file %s must contain a valid JSON", value)
			}

			return valueString, nil
		}

		return "", fmt.Errorf("value must be a path to json file or raw json in ParseJSONAsFile(): %v", value)
	default:
		return "", fmt.Errorf("Unknown type. Value must be a path to json file or raw json: %v (%T)", value, value)
	}
}
