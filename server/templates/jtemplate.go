package templates

import (
	"encoding/json"
	"fmt"
	"regexp"
	"strconv"
	"strings"
	"text/template"
	"time"

	"github.com/hashicorp/go-multierror"
)

const TransformDefaultTemplate = "return $"

var (
	unquotedSQLIdentifier = regexp.MustCompile("^(?:[a-zA-Z][a-zA-Z0-9_$#]*[.]?)+$")
	quotedSQLIdentifier   = regexp.MustCompile(`^(?:["][^"\n\r\t]+["][.]?)+$`)
	urlPattern            = regexp.MustCompile("^https?:\\/\\/(www\\.)?[-a-zA-Z0-9@:%._\\+~#=]{1,256}\\.[a-zA-Z0-9()]{1,6}\\b([-a-zA-Z0-9()@:%_\\+.~#?&//=]*)$")
)

//SmartParse is a factory method that returns TemplateExecutor implementation based on provided expression language
func SmartParse(name string, expression string, extraFunctions template.FuncMap) (TemplateExecutor, error) {
	var multiErr error
	goTmpl, err := NewGoTemplateExecutor(name, expression, extraFunctions)
	if err != nil || goTmpl.isPlainText() {
		if err != nil {
			multiErr = multierror.Append(multiErr, fmt.Errorf("error while parsing as Go: %v", err))
		}
		if unquotedSQLIdentifier.MatchString(expression) ||
			quotedSQLIdentifier.MatchString(expression) ||
			urlPattern.MatchString(expression) {
			//simple table name without templating
			return newConstTemplateExecutor(expression)
		}
		//Try parse template as JavaScript
		jsTmpl, err := NewV8TemplateExecutor(expression, extraFunctions)
		if err != nil {
			if multiErr != nil {
				err = multierror.Append(multiErr, fmt.Errorf("error while parsing as Javascript: %v", err))
			}
			return nil, err
		}
		return jsTmpl, nil
	}
	return goTmpl, nil
}

func ToJSONorStringBytes(responseObject interface{}) ([]byte, error) {
	switch raw := responseObject.(type) {
	case string:
		return []byte(strings.TrimSpace(raw)), nil
	default:
		body, err := json.MarshalIndent(raw, "", "   ")
		if err != nil {
			return nil, fmt.Errorf("cannot convert object to json: %v", err)
		}
		return body, nil
	}
}

func ToString(responseObject interface{}, allowArray bool, allowObject bool, truncateDate bool) string {
	switch obj := responseObject.(type) {
	case string:
		return obj
	case json.Number:
		return obj.String()
	case int64:
		return strconv.FormatInt(obj, 10)
	case float64:
		return strconv.FormatFloat(obj, 'f', -1, 64)
	case bool:
		return strconv.FormatBool(obj)
	case time.Time:
		if truncateDate {
			return obj.Format("2006-01-02")
		} else {
			return obj.Format(time.RFC3339Nano)
		}
	case []interface{}:
		if allowArray && len(obj) > 0 {
			//return only first element
			return ToString(obj[0], allowArray, allowObject, truncateDate)
		} else {
			return "null"
		}
	case map[string]interface{}:
		if allowObject {
			bytes, err := json.Marshal(obj)
			if err != nil {
				return "null"
			}
			return string(bytes)
		} else {
			return "null"
		}
	default:
		//javascript technically may return any kind of object.
		return "null"
	}
}
