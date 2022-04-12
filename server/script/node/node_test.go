package node_test

import (
	"reflect"
	"strings"
	"testing"

	"github.com/jitsucom/jitsu/server/script"
	"github.com/jitsucom/jitsu/server/script/node"
	"github.com/stretchr/testify/assert"
)

func factory() script.Factory {
	return node.Factory()
}

func TestBasicDescribeAndExecute(t *testing.T) {
	instance, err := factory().CreateScript(script.Expression(`return event`), nil)
	if err != nil {
		t.Fatal(err)
	}

	exports, err := instance.Describe()
	if err != nil {
		t.Fatal(err)
	}

	if len(exports) > 0 {
		t.Fatalf("anonymous function should not export anything")
	}

	defer instance.Close()
	var resp string
	if err := instance.Execute("", script.Args{"hello"}, &resp); err != nil {
		t.Fatal(err)
	}

	if resp != "hello" {
		t.Fatalf("expected hello, got %s", resp)
	}

	if err := instance.Execute("test", script.Args{}, new(interface{})); err == nil || !strings.Contains(err.Error(),
		"this executable provides an anonymous function export, but a named one (test) was given for execution") {
		t.Fatalf("got error: %+v", err)
	}
}

func TestAddExpressionAndAliases(t *testing.T) {
	instance, err := factory().CreateScript(script.Expression(`$[0] + _[1]`), nil)
	if err != nil {
		t.Fatal(err)
	}

	defer instance.Close()
	var resp int
	if err := instance.Execute("", script.Args{[]int{1, 2}}, &resp); err != nil {
		t.Fatal(err)
	}

	if resp != 3 {
		t.Fatalf("expected 3, got %d", resp)
	}
}

func TestVariables(t *testing.T) {
	instance, err := factory().CreateScript(script.Expression(`return test_value`), map[string]interface{}{
		"test_value": 10,
	})

	if err != nil {
		t.Fatal(err)
	}

	defer instance.Close()
	var resp int
	if err := instance.Execute("", script.Args{}, &resp); err != nil {
		t.Fatal(err)
	}

	if resp != 10 {
		t.Fatalf("expected 10, got %d", resp)
	}
}

func TestIncludes(t *testing.T) {
	instance, err := factory().CreateScript(script.Expression(`return test_value`), nil,
		"globalThis.test_value = 11")

	if err != nil {
		t.Fatal(err)
	}

	defer instance.Close()
	var resp int
	if err := instance.Execute("", script.Args{}, &resp); err != nil {
		t.Fatal(err)
	}

	if resp != 11 {
		t.Fatalf("expected 11, got %d", resp)
	}
}

func TestRequires(t *testing.T) {
	instance, err := factory().CreateScript(script.Expression(`
    return [require('stream'), require('http'), require('url'), require('punycode'), require('https'), require('zlib')]
        .map(e => !e ? 0 : 1)
        .reduce((a, b) => a + b)
`), nil)

	if err != nil {
		t.Fatal(err)
	}

	defer instance.Close()
	var resp int
	if err := instance.Execute("", script.Args{}, &resp); err != nil {
		t.Fatal(err)
	}

	if resp != 6 {
		t.Fatalf("expected 6, got %d", resp)
	}
}

func TestRequireFS(t *testing.T) {
	instance, err := factory().CreateScript(script.Expression(`
    return [require('fs')]
        .map(e => !e ? 0 : 1)
        .reduce((a, b) => a + b)
`), nil)

	if err != nil {
		t.Fatal(err)
	}

	defer instance.Close()
	var resp int
	if err := instance.Execute("", script.Args{}, &resp); err == nil || !strings.Contains(err.Error(), "Cannot find module 'fs'") {
		t.Fatalf("got error %+v", err)
	}
}

func TestFetchUnavailableInExpressions(t *testing.T) {
	instance, err := factory().CreateScript(script.Expression(`typeof fetch`), nil)
	if err != nil {
		t.Fatal(err)
	}

	defer instance.Close()
	var resp string
	if err := instance.Execute("", script.Args{}, &resp); err != nil {
		t.Fatal(err)
	}

	if resp != "undefined" {
		t.Fatalf("expected undefined, got %s", resp)
	}
}

func TestDescribeModule(t *testing.T) {
	instance, err := factory().CreateScript(script.File("testdata/js/describe_test.js"), nil)
	if err != nil {
		t.Fatal(err)
	}

	defer instance.Close()
	symbols, err := instance.Describe()
	if err != nil {
		t.Fatal(err)
	}

	for name, symbol := range symbols {
		var (
			expectedType  string
			expectedValue interface{}
		)

		switch name {
		case "str":
			expectedType = "string"
			expectedValue = "value"
		case "num":
			expectedType = "number"
			expectedValue = float64(42)
		case "arr":
			expectedType = "object"
			expectedValue = []interface{}{float64(1), float64(2), float64(3)}
		case "obj":
			expectedType = "object"
			expectedValue = map[string]interface{}{
				"nested": float64(4),
			}
		case "func":
			expectedType = "function"
		default:
			t.Fatalf("unknown symbol %s", name)
		}

		assert.Equal(t, expectedType, symbol.Type)
		if expectedValue != nil {
			var actualValue interface{}
			if err := symbol.As(&actualValue); err != nil {
				t.Fatal(err)
			}

			assert.Equal(t, expectedValue, actualValue)
		}
	}
}

func TestFetchIsAvailableOnlyInValidatorModuleFunction(t *testing.T) {
	instance, err := factory().CreateScript(script.File("testdata/js/fetch_test.js"), nil)
	if err != nil {
		t.Fatal(err)
	}

	defer instance.Close()
	var resp string
	if err := instance.Execute("validator", script.Args{}, &resp); err != nil {
		t.Fatal(err)
	}

	if resp != "function" {
		t.Fatalf("expected function, got %s", resp)
	}

	if err := instance.Execute("destination", script.Args{}, &resp); err != nil {
		t.Fatal(err)
	}

	if resp != "undefined" {
		t.Fatalf("expected undefined, got %s", resp)
	}
}

// testArbitraryModule loads JavaScript from `scriptPath`, executes exported `functionName` (with zero args) and
// checks that the value in `actualResult` is equal to `expectedResult`.
// `actualResult` should be a pointer to a type represented by `expectedResult`.
func executeModuleFunction(t *testing.T, scriptPath string, functionName string, expectedResult interface{}, actualResult interface{}) {
	instance, err := factory().CreateScript(script.File(scriptPath), nil)
	if err != nil {
		t.Fatal(err)
	}

	defer instance.Close()
	if err := instance.Execute(functionName, script.Args{}, actualResult); err != nil {
		t.Fatal(err)
	}

	assert.Equal(t, expectedResult, reflect.Indirect(reflect.ValueOf(actualResult)).Interface(), "on %s", scriptPath)
}

func TestArbitraryModules(t *testing.T) {
	executeModuleFunction(t, "testdata/js/fetch_test.js", "validator", "function", new(string))
	executeModuleFunction(t, "testdata/js/fetch_test.js", "destination", "undefined", new(string))
	executeModuleFunction(t, "testdata/js/describe_test.js", "func", 1, new(int))
}
