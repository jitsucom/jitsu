package node_test

import (
	"encoding/json"
	"testing"
	"time"

	"github.com/jitsucom/jitsu/server/events"
	"github.com/jitsucom/jitsu/server/script"
	"github.com/jitsucom/jitsu/server/script/node"
	"github.com/stretchr/testify/assert"
)

type testingT struct {
	*testing.T
	script.Interface
	exec script.Executable
	vars map[string]interface{}
	incl []string
}

func (t *testingT) load() *testingT {
	factory, err := node.NewFactory(1, 20, 200, nil, t.TempDir())
	if err != nil {
		t.Fatal(err)
	}

	inst, err := factory.CreateScript(t.exec, t.vars, false, t.incl...)
	if err != nil {
		t.Fatal(err)
	}

	t.Interface = inst
	return t
}

func (t *testingT) close() {
	t.Interface.Close()
}

func TestBasicDescribeAndExecute(t *testing.T) {
	tt := &testingT{T: t, exec: script.Expression(`return event`)}
	defer tt.load().close()

	exports, err := tt.Describe()
	if err != nil {
		t.Fatal(err)
	}

	assert.Equal(t, 0, len(exports), "anonymous function should not export anything")

	var resp string
	err = tt.Execute("", script.Args{"hello"}, &resp, nil)
	assert.NoError(t, err)
	assert.Equal(t, "hello", resp)

	err = tt.Execute("test", nil, new(interface{}), nil)
	if assert.Error(t, err) {
		assert.Contains(t, err.Error(), "this executable provides an anonymous function export, but a named one (test) was given for execution")
	}
}

func TestUndefined(t *testing.T) {
	tt := &testingT{T: t, exec: script.Expression(`$.user?.email`)}
	defer tt.load().close()

	exports, err := tt.Describe()
	if err != nil {
		t.Fatal(err)
	}

	assert.Equal(t, 0, len(exports), "anonymous function should not export anything")

	var resp interface{}
	err = tt.Execute("", script.Args{map[string]interface{}{}}, &resp, nil)
	assert.NoError(t, err)
	assert.Nil(t, resp)
}

func TestAddExpressionAndAliases(t *testing.T) {
	tt := &testingT{T: t, exec: script.Expression(`$[0] + _[1]`)}
	defer tt.load().close()

	var resp int
	err := tt.Execute("", script.Args{[]int{1, 2}}, &resp, nil)
	assert.NoError(t, err)
	assert.Equal(t, 3, resp)
}

func TestVariables(t *testing.T) {
	tt := &testingT{
		T:    t,
		exec: script.Expression(`return test_value`),
		vars: map[string]interface{}{
			"test_value": 10,
		},
	}

	defer tt.load().close()

	var resp int
	err := tt.Execute("", nil, &resp, nil)
	assert.NoError(t, err)
	assert.Equal(t, 10, resp)
}

func TestIncludes(t *testing.T) {
	tt := &testingT{
		T:    t,
		exec: script.Expression(`return [test_value, toSegment($)]`),
		incl: []string{
			"globalThis.test_value = 11",
			"function toSegment($) { return 1 }",
		},
	}

	defer tt.load().close()

	var resp []int
	err := tt.Execute("", nil, &resp, nil)
	assert.NoError(t, err)
	assert.Equal(t, []int{11, 1}, resp)
}

func TestOutOfMemory(t *testing.T) {
	tt := &testingT{
		T:    t,
		exec: script.Expression(`(() => { let arr = []; for (;;) { arr.push(arr); } })()`),
	}

	defer tt.load().close()

	var resp []int
	err := tt.Execute("", nil, &resp, nil)
	if assert.Error(t, err) {
		assert.Contains(t, err.Error(), "out of memory")
	}
}

func TestExpressionStackTrace(t *testing.T) {
	tt := &testingT{
		T: t,
		exec: script.Expression(`console.log("kek")
throw new Error("123")
return null`),
	}

	defer tt.load().close()

	var resp interface{}
	err := tt.Execute("", nil, &resp, nil)
	if assert.Error(t, err) {
		assert.Equal(t, "Error: 123\n  at main (2:7)", err.Error())
	}
}

func TestExpressionStackTraceNoReturn(t *testing.T) {
	tt := &testingT{
		T:    t,
		exec: script.Expression(`(() => { throw new Error("123") })()`),
	}

	defer tt.load().close()

	var resp interface{}
	err := tt.Execute("", nil, &resp, nil)
	if assert.Error(t, err) {
		assert.Equal(t, "Error: 123\n  at main (1:35)", err.Error())
	}
}

func TestFileStackTrace(t *testing.T) {
	tt := &testingT{
		T:    t,
		exec: script.File("testdata/js/stacktrace_test.js"),
	}

	defer tt.load().close()

	var resp interface{}
	err := tt.Execute("test", nil, &resp, nil)
	if assert.Error(t, err) {
		assert.Equal(t, "Error: 123\n  at Object.exports.test (3:9)", err.Error())
	}
}

func TestRequires(t *testing.T) {
	tt := &testingT{T: t, exec: script.File("testdata/js/test_require.js")}
	defer tt.load().close()

	var resp []string
	err := tt.Execute("test", nil, &resp, nil)
	assert.NoError(t, err)
	assert.Equal(t, []string{
		"function", "object", "object", "object", "object", "object",
		"function", "object", "object", "object", "object",
		"function", "object", "object", "object",
	}, resp)
}

func TestUnsafeFS(t *testing.T) {
	tt := &testingT{T: t, exec: script.File("testdata/js/test_unsafe.js")}
	defer tt.load().close()

	var resp []string
	err := tt.Execute("typeofs", nil, &resp, nil)
	assert.NoError(t, err)
	assert.Equal(t, []string{"object", "object"}, resp)

	err = tt.Execute("call_fs", nil, new(interface{}), nil)
	if assert.Error(t, err) {
		assert.Contains(t, err.Error(), "Attempt to access fs.createReadStream, which is not safe")
	}

	err = tt.Execute("call_os", nil, new(interface{}), nil)
	if assert.Error(t, err) {
		assert.Contains(t, err.Error(), "Attempt to access os.arch, which is not safe")
	}
}

func TestAsync(t *testing.T) {
	tt := &testingT{T: t, exec: script.File("testdata/js/test_async.js")}
	defer tt.load().close()

	var resp int
	err := tt.Execute("test", nil, &resp, nil)
	assert.NoError(t, err)
	assert.Equal(t, 10, resp)
}

func TestDescribeModule(t *testing.T) {
	tt := &testingT{T: t, exec: script.File("testdata/js/describe_test.js")}
	defer tt.load().close()

	symbols, err := tt.Describe()
	assert.NoError(t, err)
	assert.Equal(t, script.Symbols{
		"str":  script.Symbol{Type: "string", Value: json.RawMessage(`"value"`)},
		"num":  script.Symbol{Type: "number", Value: json.RawMessage(`42`)},
		"arr":  script.Symbol{Type: "object", Value: json.RawMessage(`[1,2,3]`)},
		"obj":  script.Symbol{Type: "object", Value: json.RawMessage(`{"nested":4}`)},
		"func": script.Symbol{Type: "function"},
		"path": script.Symbol{Type: "string", Value: json.RawMessage(`"object"`)},
	}, symbols)
}

func TestFetchIsAvailable(t *testing.T) {
	tt := &testingT{T: t, exec: script.File("testdata/js/fetch_test.js")}
	defer tt.load().close()

	var resp string
	err := tt.Execute("validator", nil, &resp, nil)
	assert.NoError(t, err)
	assert.Equal(t, "function", resp)

	err = tt.Execute("destination", nil, &resp, nil)
	assert.NoError(t, err)
	assert.Equal(t, "function", resp)
}

func TestHeaders(t *testing.T) {
	tt := &testingT{T: t, exec: script.Expression(`return $context.header("content-type")`)}
	defer tt.load().close()

	var emptyResp interface{}
	err := tt.Execute("", script.Args{events.Event{}}, &emptyResp, nil)
	assert.NoError(t, err)
	assert.Nil(t, emptyResp)

	headers := make(map[string][]string)
	headers["content-type"] = []string{"application/json"}

	var resp string
	err = tt.Execute("", script.Args{events.Event{
		events.HTTPContextField: events.HTTPContext{
			Headers: headers,
		},
	}}, &resp, nil)

	assert.NoError(t, err)
	assert.Equal(t, "application/json", resp)
}

type scriptLog struct {
	level, message string
}

func (l *scriptLog) Data(_ []byte) {

}

func (l *scriptLog) Log(level, message string) {
	l.level = level
	l.message = message
}

func (l *scriptLog) Timeout() time.Duration {
	return 0
}

func TestConsoleLog(t *testing.T) {
	tt := &testingT{T: t, exec: script.File("testdata/js/log_test.js")}
	defer tt.load().close()

	var log scriptLog
	err := tt.Execute("log", nil, nil, &log)
	assert.NoError(t, err)
	assert.Equal(t, "info", log.level)
	assert.Equal(t, "test {\n  \"a\": 1,\n  \"b\": [\n    2\n  ]\n}", log.message)

	err = tt.Execute("log_recursive", nil, nil, &log)
	assert.NoError(t, err)
	assert.Equal(t, "error", log.level)
	assert.Equal(t, "test [object Object]", log.message)
}

//for manual testing – this can take a while
//func TestThreeHundredGoroutines(t *testing.T) {
//	factory, err := node.NewFactory(50, 100, os.TempDir())
//	assert.NoError(t, err)
//	defer factory.Close()
//
//	results := make(chan int, 5_000_000)
//	var work sync.WaitGroup
//	for i := 0; i < 5000; i++ {
//		work.Add(1)
//		go func(i int) {
//			defer work.Done()
//			instance, err := factory.CreateScript(script.Expression(fmt.Sprintf(`1000 * %d + $`, i)), nil, false)
//			if !assert.NoError(t, err) {
//				t.FailNow()
//			}
//
//			for j := 0; j < 1000; j++ {
//				var result int
//				if err := instance.Execute("", script.Args{j}, &result); !assert.NoError(t, err) {
//					t.FailNow()
//				}
//
//				results <- result
//			}
//		}(i)
//	}
//
//	work.Wait()
//	close(results)
//
//	unique := make(map[int]bool)
//	for item := range results {
//		unique[item] = true
//	}
//
//	assert.Len(t, unique, 5_000_000)
//}
