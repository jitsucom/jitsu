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
}

type goTemplateExecutor struct {
	template *template.Template
}

func newGoTemplateExecutor(name string, expression string) (*goTemplateExecutor, error) {
	template, err := template.New(name).Parse(expression)
	if err != nil {
		return nil, err
	}
	return &goTemplateExecutor{template: template}, nil
}

func (gte *goTemplateExecutor) ProcessEvent(event events.Event) (interface{}, error) {
	var buf bytes.Buffer
	if err := gte.template.Execute(&buf, event); err != nil {
		return "", fmt.Errorf("error executing %s template: %v", gte.template.Name(), err)
	}
	return strings.TrimSpace(buf.String()), nil
}

func (gte *goTemplateExecutor) isPlainText() bool {
	return len(gte.template.Tree.Root.Nodes) == 1 &&
		gte.template.Tree.Root.Nodes[0].Type() == parse.NodeText
}

type jsTemplateExecutor struct {
	jsFunction func(map[string]interface{}) interface{}
}

func newJsTemplateExecutor(expression string) (*jsTemplateExecutor, error) {
	//First we need to transform js template to ES5 compatible code
	script, err := Transform(expression)
	if err != nil {
		resError := fmt.Errorf("error while transforming JavaScript template \"%s\": %v", expression, err)
		//hack to keep compatibility with JSON templating (which sadly can't be valid JS)
		script, err = Transform("return " + expression)
		if err != nil {
			//we don't report resError instead of err here because we are not sure that adding "return" was the right thing to do
			return nil, resError
		}
	}
	//loads javascript into vm instance
	function, err := LoadTemplateScript(script)
	if err != nil {
		return nil, fmt.Errorf("error while loading JavaScript template \"%s\": %v", expression, err)
	}
	return &jsTemplateExecutor{function},  nil
}

func (jte *jsTemplateExecutor) ProcessEvent(event events.Event) (interface{}, error) {
	return ProcessEvent(jte.jsFunction, event)
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
