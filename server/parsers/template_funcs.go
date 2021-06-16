package parsers

import (
	"encoding/json"
	"strconv"
	"strings"
	"text/template"
)

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
