package parsers

import (
	"bufio"
	"bytes"
	"encoding/json"
	"fmt"
	"io"
)

//ParseJSONFile converts bytes (JSON objects with \n delimiter) into slice of map with json Numbers
func ParseJSONFile(b []byte) ([]map[string]interface{}, error) {
	return ParseJSONFileWithFunc(b, ParseJSON)
}

//ParseJSONFileWithFunc converts bytes (JSON objects with \n delimiter) into slice of map with json Numbers
func ParseJSONFileWithFunc(b []byte, parseFunc func(b []byte) (map[string]interface{}, error)) ([]map[string]interface{}, error) {
	var objects []map[string]interface{}
	input := bytes.NewBuffer(b)
	reader := bufio.NewReaderSize(input, 64*1024)
	line, readErr := reader.ReadBytes('\n')

	for readErr == nil {
		object, err := parseFunc(line)
		if err != nil {
			return nil, err
		}

		objects = append(objects, object)

		line, readErr = reader.ReadBytes('\n')
		if readErr != nil && readErr != io.EOF {
			return nil, readErr
		}
	}

	return objects, nil
}

//ParseJSON converts json bytes into map with json Numbers
func ParseJSON(b []byte) (map[string]interface{}, error) {
	decoder := json.NewDecoder(bytes.NewReader(b))
	decoder.UseNumber()

	obj := map[string]interface{}{}
	err := decoder.Decode(&obj)
	return obj, err
}

//ParseFallbackJSON returns parsed into map[string]interface{} event from events.FailedFact
func ParseFallbackJSON(line []byte) (map[string]interface{}, error) {
	object, err := ParseJSON(line)
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

//ParseInterface converts interface into json bytes then into map with json Numbers
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
