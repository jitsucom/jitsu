package templates

import (
	"bytes"
	"reflect"
	"strings"
	"testing"
	"text/template"

	"github.com/stretchr/testify/require"
)

func parseHelper(event map[string]interface{}, page string) (string, error) {
	var funcs = make(map[string]interface{})
	for k, fn := range JSONSerializeFuncs {
		v := reflect.ValueOf(fn)
		if v.Kind() == reflect.Func {
			funcs[k] = fn
		}
	}
	templateObject, err := template.New("body").Funcs(funcs).Parse(page)
	if err != nil {
		return "", err
	}

	var buffer bytes.Buffer
	if err = templateObject.Execute(&buffer, event); err != nil {
		return "", err
	}

	result := strings.TrimSpace(buffer.String())
	return result, nil
}

func TestGetFunction(t *testing.T) {
	object := map[string]interface{}{
		"id":    42,
		"field": "text",
	}

	result, err := parseHelper(object, "get")
	require.Nil(t, err)
	require.Equal(t, "get", result)

	result, err = parseHelper(object, "{{get}}")
	require.NotNil(t, err)
	require.Equal(t, "", result)

	result, err = parseHelper(object, "{{get .}}")
	require.NotNil(t, err)
	require.Equal(t, "", result)

	result, err = parseHelper(object, "{{get . \"id\"}}")
	require.NotNil(t, err)
	require.Equal(t, "", result)

	result, err = parseHelper(object, "{{get . \"\" 12345}}")
	require.NotNil(t, err)
	require.Equal(t, "", result)

	result, err = parseHelper(object, "{{get . \"id\" 12345}}")
	require.Nil(t, err)
	require.Equal(t, "42", result)

	result, err = parseHelper(object, "{{get . \"text\" 12345}}")
	require.Nil(t, err)
	require.Equal(t, "12345", result)

	result, err = parseHelper(object, "{{get . \"field\" 12345}}")
	require.Nil(t, err)
	require.Equal(t, "text", result)

	result, err = parseHelper(object, "{{get \"event\" \"field\" 12345}}")
	require.NotNil(t, err)
	require.Equal(t, "", result)
}
