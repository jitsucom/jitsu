package utils

import (
	"fmt"
	"regexp"
	"strings"
)

var (
	hjsonPosition    = regexp.MustCompile(`at line (\d+),(\d+)`)
	jsonBytePosition = regexp.MustCompile(`#(\d+) byte`)
	yamlLine         = regexp.MustCompile(`line (\d+)`)
	decodeField      = regexp.MustCompile(`\* '([A-Za-z0-9_.\[\]-]{1,80})'`)
)

// DescribeConfigError says what is wrong with a configuration that failed to parse without quoting any of it.
//
// A configuration holds credentials, and the text of the error of a decoder quotes its input: jsoniter prints the bytes
// around the failure, mapstructure prints the value that did not fit, yaml prints the scalar, HJSON prints a window of the
// text around the position. So the text of such an error is never logged or returned: only a position or the name of a
// field, which are taken from it, and a fixed phrase.
func DescribeConfigError(err error) string {
	if err == nil {
		return ""
	}
	msg := err.Error()
	switch {
	case strings.Contains(msg, "error(s) decoding"):
		// mapstructure: "* 'credentials.port' expected type 'int', got unconvertible type 'string', value: '...'".
		// The name of the field is what the operator needs; the value is the secret
		var names []string
		seen := map[string]bool{}
		for _, m := range decodeField.FindAllStringSubmatch(msg, -1) {
			if !seen[m[1]] {
				seen[m[1]] = true
				names = append(names, m[1])
			}
		}
		if len(names) > 0 {
			return "a value has an unexpected type (field " + strings.Join(names, ", ") + ")"
		}
		return "a value has an unexpected type"
	case hjsonPosition.MatchString(msg):
		m := hjsonPosition.FindStringSubmatch(msg)
		return fmt.Sprintf("syntax error at line %s, column %s", m[1], m[2])
	case jsonBytePosition.MatchString(msg):
		return fmt.Sprintf("invalid JSON near byte %s", jsonBytePosition.FindStringSubmatch(msg)[1])
	case strings.HasPrefix(msg, "yaml:"):
		if m := yamlLine.FindStringSubmatch(msg); m != nil {
			return fmt.Sprintf("invalid YAML at line %s", m[1])
		}
		return "invalid YAML"
	case strings.Contains(msg, "End of input"):
		return "unexpected end of input"
	}
	return "the configuration could not be parsed (details withheld)"
}
