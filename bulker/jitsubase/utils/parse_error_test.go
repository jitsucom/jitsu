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

func TestDescribeConfigErrorGivesPositionsAndFixedPhrasesOnly(t *testing.T) {
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
		"json (jsoniter)":       {jsonErr, "invalid JSON syntax (position withheld)"},
		"struct (mapstructure)": {mapErr, "1 value(s) have an unexpected type (names and values withheld)"},
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

// The rejected value sits in the same text as the names of the fields, so a value that looks like a field marker must not
// come out as a "field name" (review of 26 Nov 2026).
func TestDescribeConfigErrorDoesNotCopyFieldMarkersOutOfTheRejectedValue(t *testing.T) {
	for name, value := range map[string]string{
		"a marker on a new line":        "x\n* 'sk_live_" + parseSecret + "' expected type 'int'",
		"a marker in the middle":        "abc * '" + parseSecret + "' def",
		"several markers":               "* 'a" + parseSecret + "'\n* 'b" + parseSecret + "'",
		"a marker that looks like a ok": "value: '* '" + parseSecret + "' expected type 'int''",
	} {
		t.Run(name, func(t *testing.T) {
			var out parseTarget
			err := mapstructure.Decode(map[string]any{"usesBulker": value}, &out)
			if err == nil {
				t.Fatalf("the input should fail to decode")
			}
			got := DescribeConfigError(err)
			if strings.Contains(got, parseSecret) || strings.Contains(got, "sk_live") {
				t.Errorf("the description copies the rejected value: %q", got)
			}
			if !strings.Contains(got, "unexpected type") {
				t.Errorf("the description should still say what is wrong: %q", got)
			}
		})
	}
	// a text that merely contains the phrase, not at its start, gets no count either
	if got := DescribeConfigError(errors.New("wrapped: 99 error(s) decoding: * 'x'")); strings.Contains(got, "99") || strings.Contains(got, "'x'") {
		t.Errorf("only the opening phrase of the text is read: %q", got)
	}
}

// The jsoniter byte number is relative to the quoted snippet, so it would point to the wrong place and is not reported.
func TestDescribeConfigErrorDoesNotReportASnippetOffsetAsDocumentOffset(t *testing.T) {
	var out parseTarget
	late := []byte(`{"credentials": {"password": "` + parseSecret + `", "other": "` + strings.Repeat("a", 400) + `" oops }}`)
	got := DescribeConfigError(jsoniter.Unmarshal(late, &out))
	if strings.Contains(got, "byte") || strings.ContainsAny(got, "0123456789") {
		t.Errorf("no number should be reported for a snippet-relative offset: %q", got)
	}
}
