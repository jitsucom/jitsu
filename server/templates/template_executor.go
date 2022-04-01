package templates

import (
	"bytes"
	"fmt"
	"github.com/jitsucom/jitsu/server/events"
	"github.com/jitsucom/jitsu/server/logging"
	"github.com/jitsucom/jitsu/server/safego"
	"github.com/jitsucom/jitsu/server/timestamp"
	"reflect"
	"rogchap.com/v8go"
	"strings"
	"sync"
	"text/template"
	"text/template/parse"
	"time"
)

const (
	jsLoadingErrorText = "JS LOADING ERROR"
	jsLoadingTest      = "js_loading_test_dummy"
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
	_, err = jte.ProcessEvent(events.Event{"event_type": jsLoadingTest})
	if err != nil && strings.HasPrefix(err.Error(), jsLoadingErrorText) {
		//we need to test that js function is properly loaded because that happens in JsTemplateExecutor's goroutine
		jte.Close()
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
			if event["event_type"] == jsLoadingTest {
				jte.results <- event
				continue
			}
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

type V8TemplateExecutor struct {
	sync.Mutex
	extraFunctions        template.FuncMap
	extraScripts          []string
	incoming              chan events.Event
	closed                chan struct{}
	results               chan interface{}
	transformedExpression string
	loadingError          error
}

func NewV8TemplateExecutor(expression string, extraFunctions template.FuncMap, extraScripts ...string) (*V8TemplateExecutor, error) {
	expression = Wrap(expression, functionName)
	v8go.SetFlags("--stack-trace-limit", "100", "--stack-size", "100", "--max-heap-size", "1000")

	vte := &V8TemplateExecutor{
		transformedExpression: expression,
		extraFunctions:        extraFunctions,
		extraScripts:          extraScripts,
		incoming:              make(chan events.Event),
		closed:                make(chan struct{}),
		results:               make(chan interface{}),
	}
	safego.RunWithRestart(func() { vte.start() })

	//we need to test that js function is properly loaded because loading happens in goroutine above
	_, err := vte.ProcessEvent(events.Event{"event_type": jsLoadingTest})
	if err != nil && strings.HasPrefix(err.Error(), jsLoadingErrorText) {
		vte.Close()
		return nil, err
	}
	return vte, nil
}

func (vte *V8TemplateExecutor) start() {
	var function func(map[string]interface{}) (interface{}, error)
	iso := v8go.NewIsolate()
	defer func() { iso.Dispose() }()
	destinationId, _ := vte.extraFunctions["destinationId"].(string)
	destinationType, _ := vte.extraFunctions["destinationType"].(string)

	//loads javascript into new vm instance
	function, err := V8LoadTemplateScript(iso, vte.transformedExpression, vte.extraFunctions, vte.extraScripts...)
	if err != nil {
		vte.loadingError = fmt.Errorf("%s: %v\ntransformed function:\n%v\n", jsLoadingErrorText, err, vte.transformedExpression)
	}
	heapStatTicker := time.NewTicker(time.Millisecond * 500)
	defer heapStatTicker.Stop()
	for {
		var event events.Event
	Loop:
		for {
			select {
			case <-vte.closed:
				return
			case <-heapStatTicker.C:
				start := timestamp.Now()
				heapStat := iso.GetHeapStatistics()
				heapSize := heapStat.TotalHeapSize
				if heapSize > 100_000_000 {
					logging.Debugf("JavaScript heap usage limit reached %s %s: %d . Reloading V8 vm", destinationId, destinationType, heapStat.TotalHeapSize)
					iso.Dispose()
					iso = v8go.NewIsolate()
					function, err = V8LoadTemplateScript(iso, vte.transformedExpression, vte.extraFunctions, vte.extraScripts...)
					if err != nil {
						logging.SystemErrorf("Reloading v8 failed: %v", err)
						vte.loadingError = fmt.Errorf("%s: Reloading v8 failed: %v\n", jsLoadingErrorText, err)
					}
					logging.Debugf("Reload duration: %s", timestamp.Now().Sub(start))
				}
			case event = <-vte.incoming:
				break Loop
			}
		}
		if vte.loadingError != nil {
			vte.results <- vte.loadingError
		} else {
			if event["event_type"] == jsLoadingTest {
				vte.results <- event
				continue
			}
			processDone := make(chan interface{})
			go func() {
				ticker := time.NewTicker(time.Second * 3)
				defer ticker.Stop()
				select {
				case <-ticker.C:
					iso.TerminateExecution()
				case <-processDone:
					return
				}
			}()
			res, err := ProcessEvent(function, event)
			close(processDone)
			if err != nil {
				vte.results <- err
			} else {
				vte.results <- res
			}
		}
	}
}

func (vte *V8TemplateExecutor) ProcessEvent(event events.Event) (res interface{}, err error) {
	vte.Lock()
	defer vte.Unlock()
	if vte.cancelled() {
		return nil, fmt.Errorf("Attempt to use closed template executor")
	}
	vte.incoming <- event
	resRaw := <-vte.results
	switch res := resRaw.(type) {
	case error:
		return nil, res
	default:
		return res, nil
	}
}

func (vte *V8TemplateExecutor) Format() string {
	return "javascript"
}

func (vte *V8TemplateExecutor) Expression() string {
	return vte.transformedExpression
}

func (vte *V8TemplateExecutor) cancelled() bool {
	select {
	case <-vte.closed:
		return true
	default:
		return false
	}
}

func (vte *V8TemplateExecutor) Close() {
	vte.Lock()
	defer vte.Unlock()
	if !vte.cancelled() {
		close(vte.closed)
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

func (cte *constTemplateExecutor) Close() {
}
