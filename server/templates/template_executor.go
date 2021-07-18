package templates

import (
	"bytes"
	"fmt"
	"github.com/jitsucom/jitsu/server/events"
	"strings"
	"sync"
	"text/template"
	"text/template/parse"
)

const (
	jsLoadingErrorText = "JS LOADING ERROR"
)

type TemplateExecutor interface {
	ProcessEvent(events.Event) (interface{}, error)
	Format() string
	Expression() string
}

type goTemplateExecutor struct {
	template *template.Template
	expression string
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
	return &goTemplateExecutor{template: tmpl, expression: expression}, nil
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

func (gte *goTemplateExecutor) Expression() string {
	return gte.expression
}

func (gte *goTemplateExecutor) isPlainText() bool {
	return len(gte.template.Tree.Root.Nodes) == 1 &&
		gte.template.Tree.Root.Nodes[0].Type() == parse.NodeText
}

type jsTemplateExecutor struct {
	jsFunction func(map[string]interface{}) interface{}
	transformedExpression string
}

type asyncJsTemplateExecutor struct {
	incoming chan events.Event
	results chan interface{}
	transformedExpression string
	loadingError error
}

type pooledTemplateExecutor struct {
	pool sync.Pool
	expression string
}

func newJsTemplateExecutor(expression string, extraFunctions template.FuncMap) (*asyncJsTemplateExecutor, error) {
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

	jte := &asyncJsTemplateExecutor{make(chan events.Event), make(chan interface{}), script, nil}
	go jte.start(extraFunctions)
	_, err = jte.ProcessEvent(events.Event{})
	if err != nil && strings.HasPrefix(err.Error(), jsLoadingErrorText) {
		//we need to test that js function is properly loaded because that happens in asyncJsTemplateExecutor's goroutine
		return nil, err
	}
	return jte, nil
}


func (jte *asyncJsTemplateExecutor) start(extraFunctions template.FuncMap) {
	//loads javascript into new vm instance
	function, err := LoadTemplateScript(jte.transformedExpression, extraFunctions)
	if err != nil {
		jte.loadingError =  fmt.Errorf("%s: %v\ntransformed function:\n%v\n",jsLoadingErrorText, err, jte.transformedExpression)
	}
	for {
		event := <- jte.incoming
		if jte.loadingError != nil {
			jte.results <- jte.loadingError
		} else {
			res, err := ProcessEvent(function, event)
			if err != nil {
				jte.results <- err
			} else {
				jte.results <- res
			}
		}
	}
}

func (jte *asyncJsTemplateExecutor) ProcessEvent(event events.Event) (interface{}, error) {
	jte.incoming <- event
	resRaw := <-jte.results
	switch res := resRaw.(type) {
	case error:
		return nil, res
	default:
		return res, nil
	}
}

func (jte *asyncJsTemplateExecutor) Format() string {
	return "javascript"
}

func (jte *asyncJsTemplateExecutor) Expression() string {
	return jte.transformedExpression
}

func (pte *pooledTemplateExecutor) ProcessEvent(event events.Event) (interface{}, error) {
	jte := pte.pool.Get().(*asyncJsTemplateExecutor)
	defer pte.pool.Put(jte)
	return jte.ProcessEvent(event)
}

func (pte *pooledTemplateExecutor) Format() string {
	return "javascript"
}

func (pte *pooledTemplateExecutor) Expression() string {
	return pte.expression
}

func (jte *jsTemplateExecutor) ProcessEvent(event events.Event) (interface{}, error) {
	return ProcessEvent(jte.jsFunction, event)
}
func (jte *jsTemplateExecutor) Format() string {
	return "javascript"
}

func (jte *jsTemplateExecutor) Expression() string {
	return jte.transformedExpression
}

func (jte *jsTemplateExecutor) load(extraFunctions template.FuncMap) error {
	//loads javascript into vm instance
	function, err := LoadTemplateScript(jte.transformedExpression, extraFunctions)
	if err != nil {
		return fmt.Errorf("%s: %v", jsLoadingErrorText, err)
	} else {
		jte.jsFunction = function
		return nil
	}
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

func (cte *constTemplateExecutor) Expression() string {
	return cte.template
}
