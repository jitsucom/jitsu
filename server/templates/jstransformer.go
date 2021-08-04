package templates

import (
	"fmt"
	"github.com/dop251/goja"
	"reflect"
	"sync"
	"text/template"
)

const functionName = "process"

var jsObjectReflectType = reflect.TypeOf(make(map[string]interface{}))
var mutex = sync.Mutex{}

//Transform transforms javascript to ES5 compatible code + adds few tweaks to loosen some rules
func Transform(src string) (string, error) {
	mutex.Lock()
	defer mutex.Unlock()
	res, err := TransformString(src, map[string]interface{}{
		"plugins": []interface{}{
			[]interface{}{"transform-last-statement", map[string]interface{}{"topLevel": true}},
			"proposal-optional-chaining",
			"transform-template-literals",
			"loop-protect",

		},
		"parserOpts":  map[string]interface{}{
			"errorRecovery": true,
			"strictMode": false,
			"allowReturnOutsideFunction": true,
			"allowSuperOutsideMethod": true},
	})
	if err != nil {
		return "",err
	}
	return `function ` + functionName + `(event) { 
var $ = event;
var _ = event;
` + res +`
};`, nil
}

//LoadTemplateScript loads script into newly created Javascript vm
//Returns func that is mapped to javascript function inside vm instance
func LoadTemplateScript(script string, extraFunctions template.FuncMap) (func(map[string]interface{}) (interface{}, error), error) {
	vm := goja.New()
	//limit call stack size to prevent endless recurison
	vm.SetMaxCallStackSize(42)
	_, err := vm.RunString(script)
	if err != nil {
		return nil, err
	}
	var fn func(map[string]interface{}) (goja.Value, error)
	err = vm.ExportTo(vm.Get(functionName), &fn)
	if err != nil {
		return nil, err
	}
	if extraFunctions != nil {
		for name, fnc := range extraFunctions {
			if err = vm.Set(name, fnc); err != nil {
				return nil, err
			}
		}
	}
	//jitsuExportWrapperFunc skips undefined fields during exporting object from vm
	var jitsuExportWrapperFunc = func(event map[string]interface{})(interface{}, error) {
		value, err := fn(event)
		if err != nil {
			return nil, err
		}
		return exportValue(&value, vm), nil
	}
	return jitsuExportWrapperFunc, nil
}

//ProcessEvent runs javascript function loaded into specified vm on provided event object
func ProcessEvent(function func(map[string]interface{}) (interface{}, error), event map[string]interface{}) (result interface{}, err error) {
	//panic handler
	defer func() {
		if r := recover(); r != nil {
			result = nil
			err = fmt.Errorf("javascript panic: %v", r)
		}
	}()
	result, err = function(event)
	if err != nil {
		err = fmt.Errorf("javascript error: %v", err)
	}
	return
}

func exportObject(o *goja.Object, vm *goja.Runtime) map[string]interface{} {
	keys := o.Keys()
	m := make(map[string]interface{}, len(keys))
	for _, itemName := range keys {
		v := o.Get(itemName)
		if v != nil {
			if v.ExportType() == nil && v.String() == "undefined" {
				continue
			}
			m[itemName] = exportValue(&v, vm)
		} else {
			m[itemName] = nil
		}
	}

	return m
}

func exportValue(vp *goja.Value, vm *goja.Runtime) interface{} {
	v := *vp
	if v.ExportType() == jsObjectReflectType {
		return exportObject(v.ToObject(vm), vm)
	} else {
		return v.Export()
	}
}