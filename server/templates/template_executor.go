package templates

import (
	"bytes"
	"fmt"
	"github.com/jitsucom/jitsu/server/events"
	"github.com/jitsucom/jitsu/server/safego"
	"reflect"
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
	Close()
}

type goTemplateExecutor struct {
	template   *template.Template
	expression string
}

func newGoTemplateExecutor(name string, expression string, extraFunctions template.FuncMap) (*goTemplateExecutor, error) {
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

func (gte *goTemplateExecutor) Close() {
}

type JsTemplateExecutor struct {
	sync.Mutex
	incoming              chan events.Event
	closed                chan struct{}
	results               chan interface{}
	transformedExpression string
	loadingError          error
}

func NewJsTemplateExecutor(expression string, extraFunctions template.FuncMap, extraScripts ...string) (*JsTemplateExecutor, error) {
	//First we need to transform js template to ES5 compatible code
	script, err := BabelizeAndWrap(expression, functionName)
	if err != nil {
		return nil, err
	}

	jte := &JsTemplateExecutor{sync.Mutex{}, make(chan events.Event), make(chan struct{}), make(chan interface{}), script, nil}
	safego.RunWithRestart(func() { jte.start(extraFunctions, extraScripts...) })
	_, err = jte.ProcessEvent(events.Event{})
	if err != nil && strings.HasPrefix(err.Error(), jsLoadingErrorText) {
		//we need to test that js function is properly loaded because that happens in JsTemplateExecutor's goroutine
		return nil, err
	}
	return jte, nil
}

func (jte *JsTemplateExecutor) start(extraFunctions template.FuncMap, extraScripts ...string) {
	//loads javascript into new vm instance
	function, err := LoadTemplateScript(jte.transformedExpression, extraFunctions, extraScripts...)
	if err != nil {
		jte.loadingError = fmt.Errorf("%s: %v\ntransformed function:\n%v\n", jsLoadingErrorText, err, jte.transformedExpression)
	}
	for {
		var event events.Event
		select {
		case <-jte.closed:
			return
		case event = <-jte.incoming:
		}
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

func (jte *JsTemplateExecutor) ProcessEvent(event events.Event) (res interface{}, err error) {
	jte.Lock()
	defer jte.Unlock()
	if jte.cancelled() {
		return nil, fmt.Errorf("Attempt to use closed template executor")
	}
	jte.incoming <- event
	resRaw := <-jte.results
	switch res := resRaw.(type) {
	case error:
		return nil, res
	default:
		return res, nil
	}
}

func (jte *JsTemplateExecutor) Format() string {
	return "javascript"
}

func (jte *JsTemplateExecutor) Expression() string {
	return jte.transformedExpression
}

func (jte *JsTemplateExecutor) cancelled() bool {
	select {
	case <-jte.closed:
		return true
	default:
		return false
	}
}

func (jte *JsTemplateExecutor) Close() {
	jte.Lock()
	defer jte.Unlock()
	close(jte.closed)
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

func (cte *constTemplateExecutor) Close() {
}
