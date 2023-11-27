package templates

import (
	"encoding/json"
	"errors"
	"strconv"
	"strings"
	"text/template"

	"github.com/jitsucom/jitsu/server/jsonutils"
)
const TableNameParameter = "JITSU_TABLE_NAME"

//JSONSerializeFuncs are additional funcs for using from text/template.
//for example for embedding whole object as JSON into another JSON
var JSONSerializeFuncs = template.FuncMap{
	"json": func(v interface{}) (string, error) {
		return marshal(v, false, false)
	},

	"json_indent": func(v interface{}) (string, error) {
		return marshal(v, true, false)
	},

	"json_indent_quote": func(v interface{}) (string, error) {
		return marshal(v, true, true)
	},

	"get": func(v interface{}, path string, defaultValue interface{}) (interface{}, error) {
		return get_impl(v, path, defaultValue)
	},

	"TABLE_NAME": TableNameParameter,
}

func EnrichedFuncMap(extraVars map[string]interface{}) template.FuncMap{
	var templateFunctions = make(map[string]interface{})
	for k,v := range JSONSerializeFuncs {
		templateFunctions[k] = v
	}
	for k,v := range extraVars {
		templateFunctions[k] = v
	}
	return templateFunctions
}

func marshal(v interface{}, indent, quote bool) (string, error) {
	var b []byte
	var err error
	if indent {
		b, err = json.MarshalIndent(v, "", "  ")

	} else {
		b, err = json.Marshal(v)
	}

	if err != nil {
		return "", err
	}

	if quote {
		quoted := strconv.Quote(string(b))
		//removes first and last quotes from "{\"key1\":123}"
		return strings.TrimPrefix(strings.TrimSuffix(quoted, `"`), `"`), nil
	}

	return string(b), nil
}

func get_impl(object interface{}, path string, defaultValue interface{}) (interface{}, error) {
	pathToElement := jsonutils.NewJSONPath(path)

	if pathToElement.IsEmpty() {
		return "", errors.New("path is empty")
	}

	event, ok := object.(map[string]interface{})
	if !ok {
		return "", errors.New("object is not a map")
	}

	value, ok := pathToElement.Get(event)
	if ok {
		return value, nil
	}

	return defaultValue, nil
}
