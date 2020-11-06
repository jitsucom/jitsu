package parsers

import (
	"bytes"
	"encoding/json"
)

//Parse json bytes into map with json Numbers
func ParseJson(b []byte) (map[string]interface{}, error) {
	decoder := json.NewDecoder(bytes.NewReader(b))
	decoder.UseNumber()

	obj := map[string]interface{}{}
	err := decoder.Decode(&obj)
	return obj, err
}
