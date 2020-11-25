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

//Return parsed into map[string]interface{} event from events.FailedFact
func ParseFallbackJson(line []byte) (map[string]interface{}, error) {
	object, err := ParseJson(line)
	if err != nil {
		return nil, err
	}

	event, ok := object["event"]
	if !ok {
		return nil, fmt.Errorf("Error parsing event %s from fallback: 'event' key doesn't exist", string(line))
	}
	objEvent, ok := event.(map[string]interface{})
	if !ok {
		return nil, fmt.Errorf("Error parsing event %s from fallback: 'event' key must be json object", string(line))
	}

	return objEvent, nil
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
