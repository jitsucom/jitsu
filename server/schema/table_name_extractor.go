package schema

import (
	"errors"
	"fmt"
	"github.com/jitsucom/jitsu/server/logging"
	"github.com/jitsucom/jitsu/server/templates"
	"github.com/jitsucom/jitsu/server/timestamp"
	"strings"
	"time"
)

//TableNameExtractor extracts table name from every JSON event
type TableNameExtractor struct {
	tableNameExtractExpression string
	tmpl                       templates.TemplateExecutor
	useTimestamp               bool
}

//NewTableNameExtractor returns configured TableNameExtractor
func NewTableNameExtractor(tableNameExtractExpression string) (*TableNameExtractor, error) {
	//Table naming
	tmpl, err := templates.SmartParse("table name extract", tableNameExtractExpression)
	if err != nil {
		return nil, fmt.Errorf("Error parsing table name template %v", err)
	}

	return &TableNameExtractor{
		tableNameExtractExpression: tableNameExtractExpression,
		tmpl:                       tmpl,
		useTimestamp:               strings.Contains(tableNameExtractExpression, timestamp.Key),
	}, nil
}

//Extract returns table name string (extracts it from JSON event with text/template expression)
//replaces all empty fields with 'null': {{.field1}} with object {'field2':2} => returns 'null'
func (tne *TableNameExtractor) Extract(object map[string]interface{}) (result string, err error) {
	//panic handler
	defer func() {
		if r := recover(); r != nil {
			result = ""
			err = fmt.Errorf("Error getting table name with expression %s: %v", tne.tableNameExtractExpression, r)
		}
	}()

	//we need time type of _timestamp field for extracting table name with date template
	if tne.useTimestamp {
		ts, ok := object[timestamp.Key]
		if !ok {
			errMsg := fmt.Sprintf("Error extracting table name: %s field doesn't exist", timestamp.Key)
			logging.SystemError(errMsg)
			return "", errors.New(errMsg)
		}
		t, err := time.Parse(time.RFC3339Nano, ts.(string))
		if err != nil {
			errMsg := fmt.Sprintf("Error extracting table name: malformed %s field: %v", timestamp.Key, err)
			logging.SystemError(errMsg)
			return "", errors.New(errMsg)
		}

		object[timestamp.Key] = t
	}

	resultObject, err := tne.tmpl.ProcessEvent(object)
	if err != nil {
		return "", fmt.Errorf("Error executing %s template: %v", tne.tableNameExtractExpression, err)
	}
	switch resultObject.(type) {
	case string:
		result = resultObject.(string)
	default:
		//TODO: maybe we need something better here
		result = ""
	}
	// format "<no value>" -> null
	formatted := strings.ReplaceAll(result, "<no value>", "null")
	// format "Abc dse" -> "abc_dse" TODO: why we do that?

	return Reformat(strings.TrimSpace(formatted)), nil
}
