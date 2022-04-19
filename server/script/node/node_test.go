package node_test

import (
	"encoding/json"
	"testing"

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
	factory, err := node.Factory()
	if err != nil {
		t.Fatal(err)
	}

	inst, err := factory.CreateScript(t.exec, t.vars, t.incl...)
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
	err = tt.Execute("", script.Args{"hello"}, &resp)
	assert.NoError(t, err)
	assert.Equal(t, "hello", resp)

	err = tt.Execute("test", nil, new(interface{}))
	if assert.Error(t, err) {
		assert.Contains(t, err.Error(), "this executable provides an anonymous function export, but a named one (test) was given for execution")
	}
}

func TestAddExpressionAndAliases(t *testing.T) {
	tt := &testingT{T: t, exec: script.Expression(`$[0] + _[1]`)}
	defer tt.load().close()

	var resp int
	err := tt.Execute("", script.Args{[]int{1, 2}}, &resp)
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
	err := tt.Execute("", nil, &resp)
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
	err := tt.Execute("", nil, &resp)
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
	err := tt.Execute("", nil, &resp)
	if assert.Error(t, err) {
		assert.Contains(t, err.Error(), "JavaScript heap out of memory")
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
	err := tt.Execute("", nil, &resp)
	if assert.Error(t, err) {
		assert.Equal(t, "Error: 123\n  at main (2:7)", err.Error())
	}
}

func TestFileStackTrace(t *testing.T) {
	tt := &testingT{
		T:    t,
		exec: script.File("testdata/js/stacktrace_test.js"),
	}

	defer tt.load().close()

	var resp interface{}
	err := tt.Execute("test", nil, &resp)
	if assert.Error(t, err) {
		assert.Equal(t, "Error: 123\n  at Object.exports.test (3:9)", err.Error())
	}
}

func TestRequires(t *testing.T) {
	tt := &testingT{T: t, exec: script.File("testdata/js/test_require.js")}
	defer tt.load().close()

	var resp []string
	err := tt.Execute("test", nil, &resp)
	assert.NoError(t, err)
	assert.Equal(t, []string{
		"function", "object", "object", "object", "object", "object",
		"function", "object", "object", "object", "object",
		"function", "object", "object", "object"}, resp)
}

func TestUnsafeFS(t *testing.T) {
	tt := &testingT{T: t, exec: script.File("testdata/js/test_unsafe.js")}
	defer tt.load().close()

	var resp []string
	err := tt.Execute("typeofs", nil, &resp)
	assert.NoError(t, err)
	assert.Equal(t, []string{"object", "object"}, resp)

	err = tt.Execute("call_fs", nil, new(interface{}))
	if assert.Error(t, err) {
		assert.Contains(t, err.Error(), "Attempt to call forbidden function fs.createReadStream().")
	}

	err = tt.Execute("call_os", nil, new(interface{}))
	if assert.Error(t, err) {
		assert.Contains(t, err.Error(), "Attempt to call forbidden function os.arch().")
	}
}

func TestAsync(t *testing.T) {
	tt := &testingT{T: t, exec: script.File("testdata/js/test_async.js")}
	defer tt.load().close()

	var resp int
	err := tt.Execute("test", nil, &resp)
	assert.NoError(t, err)
	assert.Equal(t, 10, resp)
}

func TestFetchUnavailableInExpressions(t *testing.T) {
	tt := &testingT{T: t, exec: script.Expression("typeof fetch")}
	defer tt.load().close()

	var resp string
	err := tt.Execute("", nil, &resp)
	assert.NoError(t, err)
	assert.Equal(t, "undefined", resp)
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
	}, symbols)
}

func TestFetchIsAvailableOnlyInValidatorModuleFunction(t *testing.T) {
	tt := &testingT{T: t, exec: script.File("testdata/js/fetch_test.js")}
	defer tt.load().close()

	var resp string
	err := tt.Execute("validator", nil, &resp)
	assert.NoError(t, err)
	assert.Equal(t, "function", resp)

	err = tt.Execute("destination", nil, &resp)
	assert.NoError(t, err)
	assert.Equal(t, "undefined", resp)
}
