package templates

import (
	"bytes"
	"reflect"
	"strings"
	"text/template"
	"text/template/parse"

	"github.com/jitsucom/jitsu/server/events"
	"github.com/jitsucom/jitsu/server/script"
)

type TemplateExecutor interface {
	ProcessEvent(events.Event, script.Listener) (interface{}, error)
	Format() string
	Expression() string
	Close()
}

type goTemplateExecutor struct {
	template   *template.Template
	expression string
}

func NewGoTemplateExecutor(name string, expression string, extraFunctions template.FuncMap) (*goTemplateExecutor, error) {
	tmpl := template.New(name)
	if extraFunctions != nil {
		var funcs = make(map[string]interface{})
		for k, fn := range extraFunctions {
			v := reflect.ValueOf(fn)
			if v.Kind() == reflect.Func {
				funcs[k] = fn
			}
		}
		tmpl = tmpl.Funcs(funcs)
	}
	tmpl, err := tmpl.Parse(expression)
	if err != nil {
		return nil, err
	}
	return &goTemplateExecutor{template: tmpl, expression: expression}, nil
}

func (gte *goTemplateExecutor) ProcessEvent(event events.Event, _ script.Listener) (interface{}, error) {
	var buf bytes.Buffer
	if err := gte.template.Execute(&buf, event); err != nil {
		return "", err
	}
	return strings.TrimSpace(buf.String()), nil
}

func (gte *goTemplateExecutor) Format() string {
	return "go"
}

func (gte *goTemplateExecutor) Expression() string {
	return gte.expression
}

func (gte *goTemplateExecutor) isPlainText() bool {
	return len(gte.template.Tree.Root.Nodes) == 1 &&
		gte.template.Tree.Root.Nodes[0].Type() == parse.NodeText
}

func (gte *goTemplateExecutor) Close() {
}

type constTemplateExecutor struct {
	template string
}

func newConstTemplateExecutor(expression string) (*constTemplateExecutor, error) {
	return &constTemplateExecutor{expression}, nil
}

func (cte *constTemplateExecutor) ProcessEvent(event events.Event, _ script.Listener) (interface{}, error) {
	return cte.template, nil
}

func (cte *constTemplateExecutor) Format() string {
	return "constant"
}

func (cte *constTemplateExecutor) Expression() string {
	return cte.template
}

func (cte *constTemplateExecutor) Close() {
}
