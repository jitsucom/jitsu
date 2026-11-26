package utils

import (
	"errors"
	"fmt"
	"strings"
	"testing"

	"github.com/jitsucom/bulker/jitsubase/jsoniter"
	"github.com/mitchellh/mapstructure"
	"gopkg.in/yaml.v3"
)

// JITSU-302: the text of an error from a JSON, YAML or struct decoder quotes its input: jsoniter prints the bytes around the
// failure, mapstructure prints the value that did not fit, yaml prints the scalar. A destination config holds credentials,
// so an error from parsing one must say what is wrong without quoting any of it.
type parseTarget struct {
	UsesBulker  bool `json:"usesBulker" mapstructure:"usesBulker" yaml:"usesBulker"`
	Credentials struct {
		Password string `json:"password" mapstructure:"password" yaml:"password"`
	} `json:"credentials" mapstructure:"credentials" yaml:"credentials"`
}

const parseSecret = "PARSE-ERR-SECRET-VALUE-4471"

func TestParseObjectErrorsDoNotQuoteTheInput(t *testing.T) {
	cases := map[string]any{
		"json, broken syntax":           []byte(`{"credentials": {"password": "` + parseSecret + `" oops }}`),
		"json, value of the wrong type": []byte(`{"usesBulker": "` + parseSecret + `"}`),
		"yaml, value of the wrong type": []byte("usesBulker: " + parseSecret + "\n"),
		"map, value of the wrong type":  map[string]any{"usesBulker": parseSecret},
		"map, nested value wrong type":  map[string]any{"credentials": map[string]any{"password": []string{parseSecret}}},
	}
	for name, input := range cases {
		t.Run(name, func(t *testing.T) {
			var out parseTarget
			err := ParseObject(input, &out)
			if err == nil {
				t.Fatalf("the input should not parse")
			}
			if strings.Contains(err.Error(), parseSecret) || strings.Contains(err.Error(), "PARSE-ERR") {
				t.Errorf("the error quotes the input: %v", err)
			}
		})
	}
}

func TestDescribeConfigErrorGivesPositionsAndFieldNamesOnly(t *testing.T) {
	// the raw errors of the libraries, not the sanitized ones ParseObject returns
	var out parseTarget
	jsonErr := jsoniter.Unmarshal([]byte(`{"credentials": {"password": "`+parseSecret+`" oops }}`), &out)
	mapErr := mapstructure.Decode(map[string]any{"usesBulker": parseSecret}, &out)
	yamlErr := yaml.Unmarshal([]byte("usesBulker: [\n  a: b\n  : :\n"), &out)
	hjsonText := fmt.Errorf("Found ',' where a key name was expected (check your syntax) at line 3,12 >>>  \"id\": \"a\", , \"p\": \"%s\"", parseSecret)
	for name, tc := range map[string]struct {
		err  error
		want string
	}{
		"hjson":                 {hjsonText, "syntax error at line 3, column 12"},
		"json (jsoniter)":       {jsonErr, "invalid JSON near byte "},
		"struct (mapstructure)": {mapErr, "a value has an unexpected type (field usesBulker)"},
		"yaml":                  {yamlErr, "invalid YAML"},
		"end of input":          {errors.New("End of input while parsing an object (did you forget a closing '}'?)"), "unexpected end of input"},
		"anything else":         {errors.New("boom " + parseSecret), "details withheld"},
	} {
		t.Run(name, func(t *testing.T) {
			if tc.err == nil {
				t.Fatalf("the input should fail to parse")
			}
			got := DescribeConfigError(tc.err)
			if !strings.Contains(got, tc.want) {
				t.Errorf("expected %q in %q", tc.want, got)
			}
			if strings.Contains(got, parseSecret) || strings.Contains(got, "PARSE-ERR") || strings.Contains(got, ">>>") {
				t.Errorf("the description quotes the input: %q", got)
			}
		})
	}
	if DescribeConfigError(nil) != "" {
		t.Errorf("no error, no description")
	}
}
