package templates

import (
	"encoding/json"
	"fmt"
	"github.com/dop251/goja"
	"github.com/jitsucom/jitsu/server/logging"
	"reflect"
	"rogchap.com/v8go"
	"strings"
	"sync"
	"text/template"
)

const functionName = "process"

var jsObjectReflectType = reflect.TypeOf(make(map[string]interface{}))
var mutex = sync.Mutex{}

//BabelizeAndWrap process transform event function to ES5 compatible code + adds few tweaks to loosen some rules
func BabelizeAndWrap(src, functionName string) (string, error) {
	res, err := Babelize(src)
	if err != nil {
		resError := fmt.Errorf("ES5 transforming error: %v", err)
		//hack to keep compatibility with JSON templating (which sadly can't be valid JS)
		res, err = Babelize("return " + src)
		if err != nil {
			//we do report resError instead of err here because we are not sure that adding "return" was the right thing to do
			return "", resError
		}
	}
	return Wrap(res, functionName), nil
}

//Wrap code to function + adds few tweaks to loosen some rules
func Wrap(src, functionName string) string {
	if !strings.Contains(src, "return") {
		//hack to keep compatibility with JSON templating (which sadly can't be valid JS)
		src = "return " + src
	}
	return `function ` + functionName + `(event) { 
var $ = event;
var _ = event;
` + src + `
};`
}

//Babelize transforms javascript to ES5 compatible code + adds few tweaks to loosen some rules
func Babelize(src string) (string, error) {
	mutex.Lock()
	defer mutex.Unlock()
	res, err := TransformString(src, map[string]interface{}{
		"presets": []interface{}{[]interface{}{"env", map[string]interface{}{"targets": "defaults"}}},
		"plugins": []interface{}{
			[]interface{}{"transform-last-statement", map[string]interface{}{"topLevel": true}},
			"loop-protect",
		},
		"parserOpts": map[string]interface{}{
			"errorRecovery":              true,
			"strictMode":                 false,
			"allowReturnOutsideFunction": true,
			"allowSuperOutsideMethod":    true},
	})
	if err != nil {
		return "", err
	}
	return res, nil
}

//LoadTemplateScript loads script into newly created Javascript vm
//Returns func that is mapped to javascript function inside vm instance
func LoadTemplateScript(script string, extraFunctions template.FuncMap, extraScripts ...string) (func(map[string]interface{}) (interface{}, error), error) {
	vm := goja.New()
	vm.Set("exports", map[string]interface{}{})
	//limit call stack size to prevent endless recurison
	vm.SetMaxCallStackSize(42)
	for _, sc := range extraScripts {
		_, err := vm.RunString(sc)
		if err != nil {
			return nil, fmt.Errorf("failed to load extra script: %v", err)
		}
	}
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
	vm.Set("_info", func(call goja.FunctionCall) goja.Value {
		logging.Info(valuesToObjects(call.Arguments)...)
		return nil
	})
	vm.Set("_debug", func(call goja.FunctionCall) goja.Value {
		logging.Debug(valuesToObjects(call.Arguments)...)
		return nil
	})
	vm.Set("_error", func(call goja.FunctionCall) goja.Value {
		logging.Error(valuesToObjects(call.Arguments)...)
		return nil
	})
	vm.Set("_warn", func(call goja.FunctionCall) goja.Value {
		logging.Warn(valuesToObjects(call.Arguments)...)
		return nil
	})
	vm.RunString(`let console = {log: _info, info: _info, debug: _debug, error: _error, warn: _warn}`)
	//jitsuExportWrapperFunc skips undefined fields during exporting object from vm
	var jitsuExportWrapperFunc = func(event map[string]interface{}) (interface{}, error) {
		value, err := fn(event)
		if err != nil {
			return nil, err
		}
		return exportValue(&value, vm), nil
	}
	return jitsuExportWrapperFunc, nil
}

//V8LoadTemplateScript loads script into newly created Javascript vm
//Returns func that is mapped to javascript function inside vm instance
func V8LoadTemplateScript(iso *v8go.Isolate, script string, extraFunctions template.FuncMap, extraScripts ...string) (func(map[string]interface{}) (interface{}, error), error) {
	v8ctx, err := initV8Context(iso, true, false, extraFunctions, extraScripts...)
	if err != nil {
		return nil, err
	}
	_, err = v8ctx.RunScript(script, "main.js")
	if err != nil {
		return nil, err
	}
	global := v8ctx.Global()
	funcValue, err := global.Get(functionName)
	if err != nil {
		return nil, err
	}
	fc, err := funcValue.AsFunction()
	if err != nil {
		return nil, err
	}

	//jitsuExportWrapperFunc skips undefined fields during exporting object from vm
	var jitsuExportWrapperFunc = func(event map[string]interface{}) (interface{}, error) {
		value, err := toV8Value(v8ctx, event)
		if err != nil {
			return nil, fmt.Errorf("failed to inject event to v8 function: %v", err)
		}
		res, err := fc.Call(global, value)
		if err != nil {
			return nil, err
		}
		if res.IsNullOrUndefined() {
			return nil, nil
		}
		strRes, err := v8go.JSONStringify(v8ctx, res)
		if err != nil {
			return nil, fmt.Errorf("failed json stringify js function result: %v", err)
		}
		var resP interface{}
		decoder := json.NewDecoder(strings.NewReader(strRes))
		//parse json exactly the same way as it happens in http request processing.
		//transform that does no changes must return exactly the same object as w/o transform
		decoder.UseNumber()
		err = decoder.Decode(&resP)
		if err != nil {
			return nil, fmt.Errorf("failed to unmarshal js function result: %v", err)
		}
		return resP, nil
	}
	return jitsuExportWrapperFunc, nil
}

func initV8Context(iso *v8go.Isolate, console, fetch bool, extraFunctions template.FuncMap, extraScripts ...string) (*v8go.Context, error) {
	globalTemplate := v8go.NewObjectTemplate(iso)
	globalTemplate.Set("exports", v8go.NewObjectTemplate(iso))
	if fetch {
		globalTemplate.Set("goFetchSync", v8go.NewFunctionTemplate(iso, FetchSync))
	}
	if console {
		globalTemplate.Set("_info", v8go.NewFunctionTemplate(iso, func(info *v8go.FunctionCallbackInfo) *v8go.Value {
			logging.Info(v8valuesToObjects(info.Args())...)
			return nil
		}))
		globalTemplate.Set("_debug", v8go.NewFunctionTemplate(iso, func(info *v8go.FunctionCallbackInfo) *v8go.Value {
			logging.Debug(v8valuesToObjects(info.Args())...)
			return nil
		}))
		globalTemplate.Set("_error", v8go.NewFunctionTemplate(iso, func(info *v8go.FunctionCallbackInfo) *v8go.Value {
			logging.Error(v8valuesToObjects(info.Args())...)
			return nil
		}))
		globalTemplate.Set("_warn", v8go.NewFunctionTemplate(iso, func(info *v8go.FunctionCallbackInfo) *v8go.Value {
			logging.Warn(v8valuesToObjects(info.Args())...)
			return nil
		}))
	}

	v8ctx := v8go.NewContext(iso, globalTemplate)
	global := v8ctx.Global()
	if extraFunctions != nil {
		for name, obj := range extraFunctions {
			if reflect.TypeOf(obj).Kind() != reflect.Func {
				val, err := toV8Value(v8ctx, obj)
				if err != nil {
					return nil, err
				}
				err = global.Set(name, val)
				if err != nil {
					return nil, err
				}
			}
		}
	}
	if fetch {
		v8ctx.RunScript("var global = globalThis;", "global.js")
		err := InjectFetch(v8ctx, nil)
		if err != nil {
			return nil, err
		}
	}
	if console {
		_, err := v8ctx.RunScript(`let console = {log: _info, info: _info, debug: _debug, error: _error, warn: _warn}`, "console.js")
		if err != nil {
			return nil, err
		}
	}
	for i, sc := range extraScripts {
		_, err := v8ctx.RunScript(sc, fmt.Sprintf("extra_%d.js", i))
		if err != nil {
			return nil, fmt.Errorf("failed to load extra script: %v", err)
		}
	}
	return v8ctx, nil
}

func V8EvaluateCode(script string, extraFunctions template.FuncMap, extraScripts ...string) (result interface{}, err error) {
	//panic handler
	defer func() {
		if r := recover(); r != nil {
			result = nil
			err = fmt.Errorf("javascript panic: %v", r)
		}
	}()
	iso := v8go.NewIsolate()
	defer iso.Dispose()
	v8ctx, err := initV8Context(iso, true, true, extraFunctions, extraScripts...)
	if err != nil {
		return nil, err
	}
	defer v8ctx.Close()

	res, err := v8ctx.RunScript(script, "main.js")
	if err != nil {
		return nil, err
	}

	if res.IsPromise() {
		promise, err := res.AsPromise()
		if err != nil {
			return nil, err
		}
		for promise.State() == v8go.Pending {
			v8ctx.PerformMicrotaskCheckpoint()
		}
		if promise.State() == v8go.Rejected {
			errStr, err := v8go.JSONStringify(v8ctx, promise)
			if err != nil {
				return nil, fmt.Errorf(promise.Result().DetailString())
			}
			return nil, fmt.Errorf(errStr)
		} else if promise.State() == v8go.Fulfilled {
			res = promise.Result()
		}
	}
	jsonBytes, err := res.MarshalJSON()
	if err != nil {
		return nil, fmt.Errorf("failed to marshal v8 result to json: %v", err)
	}
	var resP interface{}
	err = json.Unmarshal(jsonBytes, &resP)
	if err != nil {
		return nil, fmt.Errorf("failed to unmarshal json from v8 to go value: %v", err)
	}
	return resP, nil
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
			if goja.IsUndefined(v) {
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

func valuesToObjects(values []goja.Value) []interface{} {
	objs := make([]interface{}, 0, len(values))
	for _, o := range values {
		objs = append(objs, o.Export())
	}
	return objs
}

//func filterNulls(obj map[string]interface{}) {
//	for key, value := range obj {
//		if value == nil {
//			delete(obj, key)
//		}
//	}
//}

func v8valuesToObjects(values []*v8go.Value) []interface{} {
	objs := make([]interface{}, 0, len(values))
	for _, o := range values {
		if o.IsNull() {
			objs = append(objs, nil)
		} else {
			str, _ := v8go.JSONStringify(nil, o)
			objs = append(objs, str)
		}
	}
	return objs
}

func toV8Value(v8ctx *v8go.Context, value interface{}) (*v8go.Value, error) {
	return toV8ValueViaJSON(v8ctx, value)
}

func toV8ValueNative(v8ctx *v8go.Context, value interface{}) (*v8go.Value, error) {
	switch v := value.(type) {
	case map[string]interface{}:
		template := v8go.NewObjectTemplate(v8ctx.Isolate())
		res, err := template.NewInstance(v8ctx)
		if err != nil {
			return nil, err
		}
		for name, o := range v {
			val, err := toV8Value(v8ctx, o)
			if err != nil {
				return nil, err
			}
			err = res.Set(name, val)
			if err != nil {
				return nil, err
			}
		}
		return res.Value, nil

	case []interface{}:
		arr, err := v8ctx.RunScript("new Array()", "array.js")
		if err != nil {
			return nil, err
		}
		arrayObject, err := arr.AsObject()
		if err != nil {
			return nil, err
		}
		for i, el := range v {
			val, err := toV8Value(v8ctx, el)
			if err != nil {
				return nil, err
			}
			err = arrayObject.SetIdx(uint32(i), val)
			if err != nil {
				return nil, err
			}
		}
		return arrayObject.Value, nil
	case json.Number:
		//i, err := v.Int64()
		//if err != nil {
		f, err := v.Float64()
		if err != nil {
			return v8go.NewValue(v8ctx.Isolate(), v.String())
		}
		return v8go.NewValue(v8ctx.Isolate(), f)
		//}
		//return v8go.NewValue(v8ctx.Isolate(), i)
	case nil:
		return v8go.Null(v8ctx.Isolate()), nil
	default:
		return v8go.NewValue(v8ctx.Isolate(), v)
	}
}

func toV8ValueViaJSON(v8ctx *v8go.Context, value interface{}) (*v8go.Value, error) { //str, err := json.Marshal(event)
	str, err := json.Marshal(value)
	if err != nil {
		return nil, err
	}
	res, err := v8go.JSONParse(v8ctx, string(str))
	if err != nil {
		return nil, err
	}
	return res, nil
}
