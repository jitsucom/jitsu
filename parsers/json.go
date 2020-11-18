package parsers

import (
	"bytes"
	"encoding/json"
	"fmt"
)

//Parse json bytes into map with json Numbers
func ParseJson(b []byte) (map[string]interface{}, error) {
	decoder := json.NewDecoder(bytes.NewReader(b))
	decoder.UseNumber()

	obj := map[string]interface{}{}
	err := decoder.Decode(&obj)
	return obj, err
}

//Parse interface into json bytes then into map with json Numbers
func ParseInterface(v interface{}) (map[string]interface{}, error) {
	b, err := json.Marshal(v)
	if err != nil {
		return nil, fmt.Errorf("Error marshalling value: %v", err)
	}
	decoder := json.NewDecoder(bytes.NewReader(b))
	decoder.UseNumber()

	obj := map[string]interface{}{}
	err = decoder.Decode(&obj)
	return obj, err
}
