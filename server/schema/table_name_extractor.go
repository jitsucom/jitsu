package schema

import (
	"errors"
	"fmt"
	"strings"
	"text/template"
	"time"

	"github.com/jitsucom/jitsu/server/logging"
	"github.com/jitsucom/jitsu/server/templates"
	"github.com/jitsucom/jitsu/server/timestamp"
)

//TableNameExtractor extracts table name from every JSON event
type TableNameExtractor struct {
	Expression   string
	tmpl         templates.TemplateExecutor
	useTimestamp bool
}

//NewTableNameExtractor returns configured TableNameExtractor
func NewTableNameExtractor(tableNameExtractExpression string, funcMap template.FuncMap) (*TableNameExtractor, error) {
	//Table naming
	tmpl, err := templates.SmartParse("table name extract", tableNameExtractExpression, funcMap)
	if err != nil {
		return nil, fmt.Errorf("table name template parsing error: %v", err)
	}

	return &TableNameExtractor{
		Expression:   tmpl.Expression(),
		tmpl:         tmpl,
		useTimestamp: strings.Contains(tableNameExtractExpression, timestamp.Key),
	}, nil
}

//Extract returns table name string.
//Extracts it from JSON event with text/template expression or javascript code.
//replaces all empty fields with 'null': {{.field1}} with object {'field2':2} => returns 'null'
func (tne *TableNameExtractor) Extract(object map[string]interface{}) (result string, err error) {
	//panic handler
	defer func() {
		if r := recover(); r != nil {
			result = ""
			err = fmt.Errorf("error getting table name: %v", r)
		}
	}()

	//we need time type of _timestamp field for extracting table name with date template
	if tne.useTimestamp {
		ts, ok := object[timestamp.Key]
		if !ok {
			errMsg := fmt.Sprintf("error extracting table name: %s field doesn't exist", timestamp.Key)
			logging.SystemError(errMsg)
			return "", errors.New(errMsg)
		}
		t, err := time.Parse(time.RFC3339Nano, ts.(string))
		if err != nil {
			errMsg := fmt.Sprintf("error extracting table name: malformed %s field: %v", timestamp.Key, err)
			logging.SystemError(errMsg)
			return "", errors.New(errMsg)
		}

		object[timestamp.Key] = t
	}

	resultObject, err := tne.tmpl.ProcessEvent(object, nil)
	if err != nil {
		return "", fmt.Errorf("error executing template: %v", err)
	}
	result = templates.ToString(resultObject, false, false, true)
	// format "<no value>" -> null
	formatted := strings.ReplaceAll(result, "<no value>", "null")
	return Reformat(strings.TrimSpace(formatted)), nil
}

func (tne *TableNameExtractor) Format() string {
	return tne.tmpl.Format()
}

func (tne *TableNameExtractor) Close() {
	tne.tmpl.Close()
}
