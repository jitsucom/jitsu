package templates

import (
	"bytes"
	"fmt"
	"github.com/jitsucom/jitsu/server/events"
	"strings"
	"text/template"
	"text/template/parse"
)

type TemplateExecutor interface {
	ProcessEvent(events.Event) (interface{}, error)
	Format() string
}

type goTemplateExecutor struct {
	template *template.Template
}

func newGoTemplateExecutor(name string, expression string, extraFunctions template.FuncMap) (*goTemplateExecutor, error) {
	tmpl := template.New(name)
	if extraFunctions != nil {
		tmpl = tmpl.Funcs(extraFunctions)
	}
	tmpl, err := tmpl.Parse(expression)
	if err != nil {
		return nil, err
	}
	return &goTemplateExecutor{template: tmpl}, nil
}

func (gte *goTemplateExecutor) ProcessEvent(event events.Event) (interface{}, error) {
	var buf bytes.Buffer
	if err := gte.template.Execute(&buf, event); err != nil {
		return "", err
	}
	return strings.TrimSpace(buf.String()), nil
}

func (gte *goTemplateExecutor) Format() string {
	return "go"
}

func (gte *goTemplateExecutor) isPlainText() bool {
	return len(gte.template.Tree.Root.Nodes) == 1 &&
		gte.template.Tree.Root.Nodes[0].Type() == parse.NodeText
}

type jsTemplateExecutor struct {
	jsFunction func(map[string]interface{}) interface{}
}

func newJsTemplateExecutor(expression string, extraFunctions template.FuncMap) (*jsTemplateExecutor, error) {
	//First we need to transform js template to ES5 compatible code
	script, err := Transform(expression)
	if err != nil {
		resError := fmt.Errorf("js transforming error: %v", err)
		//hack to keep compatibility with JSON templating (which sadly can't be valid JS)
		script, err = Transform("return " + expression)
		if err != nil {
			//we don't report resError instead of err here because we are not sure that adding "return" was the right thing to do
			return nil, resError
		}
	}
	//loads javascript into vm instance
	function, err := LoadTemplateScript(script, extraFunctions)
	if err != nil {
		return nil, fmt.Errorf("js loading error: %v", err)
	}
	return &jsTemplateExecutor{function},  nil
}

func (jte *jsTemplateExecutor) ProcessEvent(event events.Event) (interface{}, error) {
	return ProcessEvent(jte.jsFunction, event)
}
func (jte *jsTemplateExecutor) Format() string {
	return "javascript"
}

type constTemplateExecutor struct {
	template string
}
func newConstTemplateExecutor(expression string) (*constTemplateExecutor, error) {
	return &constTemplateExecutor{expression}, nil
}

func (cte *constTemplateExecutor) ProcessEvent(event events.Event) (interface{}, error) {
	return cte.template, nil
}

func (cte *constTemplateExecutor) Format() string {
	return "constant"
}
