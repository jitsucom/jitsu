package deno_test

import (
	"strings"
	"testing"

	"github.com/jitsucom/jitsu/server/script"
	"github.com/jitsucom/jitsu/server/script/deno"
)

func factory() script.Factory {
	return deno.Factory()
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
	instance, err := factory().CreateScript(script.Expression(`return $[0] + _[1]`), nil)
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

// TODO we need this
//
//func TestRequires(t *testing.T) {
//	instance, err := factory().CreateScript(script.Expression(`
//    return [require('stream'), require('http'), require('url'), require('punycode'), require('https'), require('zlib')]
//        .map(e => !e ? 0 : 1)
//        .reduce((a, b) => a + b)
//`), nil)
//
//	if err != nil {
//		t.Fatal(err)
//	}
//
//	defer instance.Close()
//	var resp int
//	if err := instance.Execute("", script.Args{}, &resp); err != nil {
//		t.Fatal(err)
//	}
//
//	if resp != 6 {
//		t.Fatalf("expected 6, got %d", resp)
//	}
//}
//
//func TestRequireFS(t *testing.T) {
//	instance, err := factory().CreateScript(script.Expression(`
//    return [require('fs')]
//        .map(e => !e ? 0 : 1)
//        .reduce((a, b) => a + b)
//`), nil)
//
//	if err != nil {
//		t.Fatal(err)
//	}
//
//	defer instance.Close()
//	var resp int
//	if err := instance.Execute("", script.Args{}, &resp); err == nil || !strings.Contains(err.Error(), "Cannot find module 'fs'") {
//		t.Fatalf("got error %+v", err)
//	}
//}
