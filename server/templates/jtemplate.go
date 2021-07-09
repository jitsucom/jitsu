package templates

import (
	"fmt"
	"github.com/hashicorp/go-multierror"
	"regexp"
)

var (
	unquotedSQLIdentifier = regexp.MustCompile("^(?:[a-zA-Z][a-zA-Z0-9_$#]*[.]?)+$")
	quotedSQLIdentifier = regexp.MustCompile(`^(?:["][^"\n\r\t]+["][.]?)+$`)

)

//SmartParse is a factory method that returns TemplateExecutor implementation based on provided expression language
func SmartParse(name string, expression string) (TemplateExecutor, error) {
	var multiErr error
	goTmpl, err := newGoTemplateExecutor(name, expression)
	if err != nil || goTmpl.isPlainText() {
		if err != nil {
			multiErr = multierror.Append(multiErr, fmt.Errorf("error while parsing Go template \"%s\": %v", expression, err))
		}
		if unquotedSQLIdentifier.MatchString(expression) ||
			quotedSQLIdentifier.MatchString(expression) {
			//simple table name without templating
			return newConstTemplateExecutor(expression)
		}
		//Try parse template as JavaScript
		jsTmpl, err := newJsTemplateExecutor(expression)
		if err != nil {
			return nil, multierror.Append(multiErr, fmt.Errorf("error while parsing Go template \"%s\": %v", expression, err))
		}
		return jsTmpl, nil
	}
	return goTmpl, nil
}