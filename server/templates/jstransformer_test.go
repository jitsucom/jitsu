package templates

import (
	"github.com/google/go-cmp/cmp"
	"io/ioutil"
	"testing"
)

type object = map[string]interface{}

var JSTemplateTest = []struct {
	filename string
	input    map[string]interface{}
	expected interface{}
}{
	{"test_data/table_name_expression.js", object{}, nil},
	{"test_data/table_name_expression.js", object{"event_type": "app_page"}, "app"},
	{"test_data/table_name_expression.js", object{"event_type": "important", "user": object{"email": "reg@ksense.io"}}, "app"},
	{"test_data/table_name_expression.js", object{"event_type": "important", "user": object{"email": "test@test.com"}}, "important"},

	{"test_data/table_name_expression2.js", object{}, "undefinedweb_test"},
	{"test_data/table_name_expression2.js", object{"metric_type": "good_metric"}, "good_metric"},
	{"test_data/table_name_expression2.js", object{"app": "some_app"}, "some_appweb_test"},
	{"test_data/table_name_expression2.js", object{"metric_type": "important", "app": "some_app"}, "important"},

	{"test_data/table_name_logic.js", object{}, false},
	{"test_data/table_name_logic.js", object{"event_type": "app_page"}, "app"},
	{"test_data/table_name_logic.js", object{"event_type": "important", "doc_host": "asd--jitsu-cloud.netlify.app"}, nil},
	{"test_data/table_name_logic.js", object{"event_type": "important", "user": object{"email": "test@jitsu.com"}}, ""},
	//undefined converted to nil
	{"test_data/table_name_logic.js", object{"event_type": "important", "user": object{"email": "test@undefined.com"}}, nil},

	{"test_data/object_expression.js", object{}, object{"user_id": nil, "event_type1": nil, "event_type2": nil, "user": object{"email": nil}}},
	{"test_data/object_expression.js", object{"event_type": "app_page"}, object{"user_id": nil, "event_type1": "app_page", "event_type2": "APP_PAGE", "user": object{"email": nil}}},
	{"test_data/object_expression.js", object{"event_type": "important", "user": object{"email": "reg@ksense.io"}}, object{"user_id": nil, "event_type1": "important", "event_type2": "IMPORTANT", "user": object{"email": "reg@ksense.io"}}},
	{"test_data/object_expression.js", object{"event_type": "important", "user": object{"email": "test@test.com"}}, object{"user_id": nil, "event_type1": "important", "event_type2": "IMPORTANT", "user": object{"email": "test@test.com"}}},

	{"test_data/object_construct.js", object{}, object{"event_type1": nil, "event_type2": nil}},
	{"test_data/object_construct.js", object{"event_type": "app_page"}, object{"event_type1": "app_page", "event_type2": "APP_PAGE"}},
	{"test_data/object_construct.js", object{"event_type": "important", "user": object{"email": "reg@ksense.io"}}, object{"event_type1": "important", "event_type2": "IMPORTANT", "email": "reg@ksense.io"}},
	{"test_data/object_construct.js", object{"event_type": "important", "user": object{"email": "test@test.com"}}, object{"event_type1": "important", "event_type2": "IMPORTANT", "email": "test@test.com"}},

	{"test_data/object_modify.js", object{}, object{"event_type": "skipped"}},
	{"test_data/object_modify.js", object{"event_type": "app_page"}, object{"event_type": "app"}},
	{"test_data/object_modify.js", object{"event_type": "important", "user": object{"email": "reg@ksense.io"}}, object{"event_type": "jitsu", "user": object{"email": "reg@ksense.io"}}},
	{"test_data/object_modify.js", object{"event_type": "important", "user": object{"email": "test@test.com"}}, object{"event_type": "skipped", "user": object{"email": "test@test.com"}}},

	{"test_data/arrow_function.js", object{"event_type": "app_page"}, "APP_PAGE"},

	//TODO: babels plugin transform-template-literals ruins emoji characters 😢 disable test for now
	//{"test_data/template_literal_emoji.js", object{"event_type": "app_page"}, "🤘 app_page"},

}

func TestTransform(t *testing.T) {
	for _, tt := range JSTemplateTest {
		t.Run(tt.filename, func(t *testing.T) {
			file, err := ioutil.ReadFile(tt.filename)
			if err != nil {
				panic(err)
			}
			script, err := BabelizeAndWrap(string(file), functionName)
			if err != nil {
				t.Errorf("%s Transforming failed: %v", tt.filename, err)
				return
			}

			function, err := LoadTemplateScript(script, nil)
			if err != nil {
				t.Errorf("%s Failed loading script into vm: %v", tt.filename, err)
			}
			for i := 0; i < 10; i++ {
				var input = make(map[string]interface{})
				for k, v := range tt.input {
					input[k] = v
				}
				res, err := ProcessEvent(function, input)
				if err != nil {
					t.Errorf("%s Failed running \"process\" script: %s\nInput: %s\nErr: %v", tt.filename, script, tt.input, err)
					break
				} else if !cmp.Equal(res, tt.expected) {
					t.Errorf("%s transpiled to: %s\nInput: %s\nResult: %s\nNot equal\nExpected: %s", tt.filename, script, tt.input, res, tt.expected)
					break
				} else {
					//t.Logf("%s transpiled to: %s\nInput: %s\nResult: %s\nExpected: %s", tt.filename, script, tt.input, res, tt.expected)
				}
			}
		})
	}
}
