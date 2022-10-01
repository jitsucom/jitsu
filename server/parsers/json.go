package parsers

import (
	"bufio"
	"bytes"
	"encoding/json"
	"fmt"
	"github.com/mitchellh/mapstructure"
	"github.com/pkg/errors"
	"io"
)

type ParseError struct {
	Original []byte
	Error    string
}

// ParseJSONFile converts bytes (JSON objects with \n delimiter) into slice of map with json Numbers
func ParseJSONFile(b []byte) ([]map[string]interface{}, error) {
	return ParseJSONFileWithFunc(b, ParseJSON)
}

// ParseJSONFileWithFunc converts bytes (JSON objects with \n delimiter) into slice of map with json Numbers
// failfast: returns err if at least 1 occurred
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

	if readErr != nil && readErr != io.EOF {
		return nil, readErr
	}

	return objects, nil
}

// ParseJSONBytesWithFuncFallback converts bytes (JSON objects with \n delimiter) into slice of map with json Numbers
// returns slice with events and slice with parsing errors which contains malformed JSON's(malformed lines)
func ParseJSONBytesWithFuncFallback(b []byte, parseFunc func(b []byte) (map[string]interface{}, error)) ([]map[string]interface{}, []ParseError, error) {
	var parseErrors []ParseError
	var objects []map[string]interface{}
	input := bytes.NewBuffer(b)
	reader := bufio.NewReaderSize(input, 64*1024)
	line, readErr := reader.ReadBytes('\n')

	for readErr == nil {
		object, err := parseFunc(line)
		if err != nil {
			parseErrors = append(parseErrors, ParseError{
				Original: line,
				Error:    err.Error(),
			})
		} else {
			objects = append(objects, object)
		}

		line, readErr = reader.ReadBytes('\n')
		if readErr != nil && readErr != io.EOF {
			return nil, nil, readErr
		}
	}

	if readErr != nil && readErr != io.EOF {
		return nil, nil, readErr
	}

	return objects, parseErrors, nil
}

// ParseJSONFileWithFuncFallback converts bytes (JSON objects with \n delimiter) into slice of map with json Numbers
// returns slice with events and slice with parsing errors which contains malformed JSON's(malformed lines)
func ParseJSONFileWithFuncFallback(r io.Reader, parseFunc func(b []byte) (map[string]interface{}, error)) ([]map[string]interface{}, []ParseError, error) {
	var parseErrors []ParseError
	var objects []map[string]interface{}

	scanner := bufio.NewScanner(r)
	for scanner.Scan() {
		object, err := parseFunc(scanner.Bytes())
		if err != nil {
			parseErrors = append(parseErrors, ParseError{
				Original: scanner.Bytes(),
				Error:    err.Error(),
			})
		} else {
			objects = append(objects, object)
		}

	}

	return objects, parseErrors, nil
}

// ParseJSON converts json bytes into map with json Numbers
// removes first empty bytes if exist
func ParseJSON(b []byte) (map[string]interface{}, error) {
	obj := map[string]interface{}{}

	err := ParseJSONAsObject(b, &obj)
	if err != nil {
		return nil, fmt.Errorf("cannot unmarshal bytes into Go value of type map[string]interface {}: %v", err)
	}

	return obj, nil
}

// ParseJSONAsObject converts json bytes into the object
// removes first empty bytes if exist
func ParseJSONAsObject(b []byte, value interface{}) error {
	b = RemoveFirstEmptyBytes(b)

	decoder := json.NewDecoder(bytes.NewReader(b))
	decoder.UseNumber()

	return decoder.Decode(&value)
}

// ParseInterface converts interface into json bytes then into map with json Numbers
func ParseInterface(v interface{}) (map[string]interface{}, error) {
	obj := map[string]interface{}{}
	if err := mapstructure.Decode(v, &obj); err != nil {
		return nil, errors.Wrap(err, "decode value error")
	}

	return obj, nil
}

// RemoveFirstEmptyBytes checks if array contains empty bytes in the begging and removes them
func RemoveFirstEmptyBytes(b []byte) []byte {
	p := 0
	for _, v := range b {
		if v != 0 {
			break
		}
		p++
	}
	if p > 0 {
		b = b[p:]
	}

	return b
}
