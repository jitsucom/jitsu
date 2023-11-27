package jsonutils

import (
	"encoding/json"
	"strings"
)

const multiplePathsDelimiter = "||"

type JSONPath interface {
	IsEmpty() bool
	Get(obj map[string]interface{}) (interface{}, bool)
	GetAndRemove(obj map[string]interface{}) (interface{}, bool)
	Set(obj map[string]interface{}, value interface{}) error
	SetIfNotExist(obj map[string]interface{}, value interface{}) error
	SetOrMergeIfExist(obj map[string]interface{}, values map[string]interface{}) error
	String() string
	FieldName() string
}

//NewJSONPath return JSONPath (Single or Multiple)
func NewJSONPath(path string) JSONPath {
	if strings.Contains(path, multiplePathsDelimiter) {
		return NewMultipleJSONPath(strings.Split(path, multiplePathsDelimiter))
	}

	return NewSingleJSONPath(path)
}

func formatPrefixSuffix(key string) string {
	if strings.HasPrefix(key, "/") {
		key = key[1:]
	}
	if strings.HasSuffix(key, "/") {
		key = key[:len(key)-1]
	}

	return key
}

func JsonEscape(i string) string {
	b, err := json.Marshal(i)
	if err != nil {
		panic(err)
	}
	s := string(b)
	return s[1:len(s)-1]
}

