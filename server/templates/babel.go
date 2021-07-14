package templates

import (
	_ "embed"
	"fmt"
	"io"
	"io/ioutil"
	"strings"
	"sync"

	"github.com/dop251/goja"
)

const DefaultPoolSize = 1

type babelTransformer struct {
	Runtime   *goja.Runtime
	Transform func(string, map[string]interface{}) (goja.Value, error)
}

func (t *babelTransformer) Done() {
	globalpool <- t
}

var once = &sync.Once{}
var globalpool chan *babelTransformer
var babelProg *goja.Program

func Init(poolSize int) (err error) {
	once.Do(func() {
		if e := compileBabel(); e != nil {
			err = e
			return
		}
		globalpool = make(chan *babelTransformer, poolSize)
		for i := 0; i < poolSize; i++ {
			vm := goja.New()

			// define console.{log|error|warn} so loading babel doesn't error
			logFunc := func(goja.FunctionCall) goja.Value { return nil }
			vm.Set("console", map[string]func(goja.FunctionCall) goja.Value{
				"log":   logFunc,
				"error": logFunc,
				"warn":  logFunc,
			})

			transformFn, e := loadBabel(vm)
			if e != nil {
				err = e
				return
			}
			globalpool <- &babelTransformer{Runtime: vm, Transform: transformFn}
		}
	})

	return err
}

func TransformReader(src io.Reader, opts map[string]interface{}) (io.Reader, error) {
	data, err := ioutil.ReadAll(src)
	if err != nil {
		return nil, err
	}
	res, err := TransformString(string(data), opts)
	if err != nil {
		return nil, err
	}
	return strings.NewReader(res), nil
}

func TransformString(src string, opts map[string]interface{}) (string, error) {
	if opts == nil {
		opts = map[string]interface{}{}
	}
	t, err := getTransformer()
	if err != nil {
		return "", err
	}
	defer func() { t.Done() }() // Make transformer available again when we're done
	v, err := t.Transform(src, opts)
	if err != nil {
		return "", err
	}
	vm := t.Runtime
	return v.ToObject(vm).Get("code").String(), nil
}

func getTransformer() (*babelTransformer, error) {
	// Make sure we have a pool created
	if len(globalpool) == 0 {
		if err := Init(DefaultPoolSize); err != nil {
			return nil, err
		}
	}
	for {
		t := <-globalpool
		return t, nil
	}
}

//go:embed js/babel.js
var babelData string

//go:embed js/transform-last-statement.js
var transformLastStatementData string

//go:embed js/loop-protect.js
var loopProtectData string

func compileBabel() error {
	var err error
	babelProg, err = goja.Compile("babel.js", babelData, false)
	if err != nil {
		return err
	}

	return nil
}

func loadBabel(vm *goja.Runtime) (func(string, map[string]interface{}) (goja.Value, error), error) {
	_, err := vm.RunProgram(babelProg)
	if err != nil {
		return nil, fmt.Errorf("unable to load babel.js: %s", err)
	}
	transformProg, err := goja.Compile("transform-last-statement.js", transformLastStatementData, false)
	if err != nil {
		return nil, fmt.Errorf("unable to compile transform-last-statement.js: %s", err)
	}
	_, err = vm.RunProgram(transformProg)
	if err != nil {
		return nil, fmt.Errorf("unable to run transform-last-statement.js: %s", err)
	}
	loopProtectProg, err := goja.Compile("loop-protect.js", loopProtectData, false)
	if err != nil {
		return nil, fmt.Errorf("unable to compile loop-protect.js: %s", err)
	}
	_, err = vm.RunProgram(loopProtectProg)
	if err != nil {
		return nil, fmt.Errorf("unable to run loop-protect.js: %s", err)
	}
	var transform goja.Callable
	babel := vm.Get("Babel")
	if err := vm.ExportTo(babel.ToObject(vm).Get("transform"), &transform); err != nil {
		return nil, fmt.Errorf("unable to export transform fn: %s", err)
	}
	return func(src string, opts map[string]interface{}) (goja.Value, error) {
		return transform(babel, vm.ToValue(src), vm.ToValue(opts))
	}, nil
}
