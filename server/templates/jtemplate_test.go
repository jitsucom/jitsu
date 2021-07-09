package templates

import (
	"fmt"
	"github.com/google/go-cmp/cmp"
	"github.com/jitsucom/jitsu/server/events"
	"io/ioutil"
	"strings"
	"testing"
)

type templateTestData = struct {
	name string
	template string
	event  events.Event
	expected interface{}
}

var templateTest = []templateTestData{
	{"go1", "{{if .metric_type }}{{ .metric_type }}_test{{else}}{{ .app }}_web_test {{end}}", events.Event{"metric_type": "ogon", "app": "neagon"}, "ogon_test"},
	{"go2", "Hello {{ .metric_type }}", events.Event{"metric_type": "ogon", "app": "neagon"}, "Hello ogon"},
	{"go3", `{{if or (eq .event_type "user_identify") (eq .event_type "identify")}}
          {{"identifies"}}
        {{else}}
          {{if or (eq .event_type "page") (eq .event_type "pageview")}}
            {{"pages"}}
          {{else}}
            {{.event_type}}
          {{end}}
        {{end}}`, events.Event{"event_type": "page"}, "pages"},
	{"go_and_js_error", "if (true) {{return func(){ .metric_type }}}", events.Event{"metric_type": "ogon", "app": "neagon"}, fmt.Errorf("2 errors occurred")},
	{"golike_js", "if (true) {var a = function(){ metric_type }} return $.metric_type", events.Event{"metric_type": "ogon", "app": "neagon"}, "ogon"},

	{"const: \"table_name\"", "\"table_name\"", events.Event{"metric_type": "ogon"}, "\"table_name\""},
	{"const: table_name", "table_name", events.Event{"metric_type": "ogon"}, "table_name"},
	{"const: table name (err)", "table name", events.Event{"metric_type": "ogon"}, fmt.Errorf("javascript error: ReferenceError")},
	{"const: \"table name\"", "\"table name\"", events.Event{"metric_type": "ogon"}, "\"table name\""},
	{"const: data_base.table1", "data_base.table1", events.Event{"metric_type": "ogon"}, "data_base.table1"},
	{"const: \"data base\".\"table1\"", "\"data base\".\"table1\"", events.Event{"metric_type": "ogon"}, "\"data base\".\"table1\""},

}

func TestJtemplate(t *testing.T) {
	for _, tt := range templateTest {
		t.Run(tt.name, func(t *testing.T) {
			test(t, tt)
		})
	}
}

func TestJavascriptTemplate(t *testing.T) {
	for _, jstt := range JSTemplateTest {
		file, err := ioutil.ReadFile(jstt.filename)
		if err != nil {
			t.Errorf("cannot open file with test data %s : %v", jstt.filename, err)
			continue
		}
		var tt = templateTestData{name: jstt.filename, template: string(file), event: jstt.input, expected: jstt.expected}
		t.Run(tt.name, func(t *testing.T) {
			test(t, tt)
		})
	}
}

func test(t *testing.T, data templateTestData) {
	t.Logf("Test %s. Template:\n%s\nInput: %s\nExpected: %s", data.name, data.template, data.event, data.expected)
	templateExecutor, err := SmartParse(data.name, data.template)
	if err != nil {
		testExpectedError(t, data, err)
		return
	}
	value, err := templateExecutor.ProcessEvent(data.event)
	if err != nil {
		testExpectedError(t, data, err)
	} else if !cmp.Equal(value, data.expected) {
		t.Errorf("Not equals. %v != expected: %v", value, data.expected)
	} else {
		t.Logf("%s", value)
	}
}

func testExpectedError(t *testing.T, data templateTestData, err error) {
	switch data.expected.(type) {
	case error:
		if strings.HasPrefix(err.Error(), data.expected.(error).Error()) {
			t.Logf("Expected error: %v", err)
		} else {
			t.Errorf("unexpected error: %v\n Expected: %v", err, data.expected)
		}
	default:
		t.Error(err)
	}
}