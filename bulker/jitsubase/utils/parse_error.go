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
	decodeCount      = regexp.MustCompile(`^(\d{1,3}) error\(s\) decoding`)
)

// DescribeConfigError says what is wrong with a configuration that failed to parse without quoting any of it.
//
// A configuration holds credentials, and the text of the error of a decoder quotes its input: jsoniter prints the bytes
// around the failure, mapstructure prints the value that did not fit, yaml prints the scalar, HJSON prints a window of the
// text around the position. So the text of such an error is never logged or returned: only a line and column that HJSON and
// YAML report, the number of failed fields that mapstructure states in its fixed opening phrase, and fixed phrases.
//
// Names of fields are NOT taken from the text of a decoding error: the rejected value sits in the same text, so a value that
// is shaped like a field marker would be copied out as a "field name". The jsoniter byte number is not reported either: it
// counts from the start of the quoted snippet, not of the document, so it would point to the wrong place.
// jsoniter gives a syntax error and a value of the wrong type the same marker, so the phrase covers both.
func DescribeConfigError(err error) string {
	if err == nil {
		return ""
	}
	msg := err.Error()
	switch {
	case strings.Contains(msg, "error(s) decoding"):
		// mapstructure: "1 error(s) decoding:\n\n* 'credentials.port' expected type 'int', ... value: '...'". Only the count of
		// the opening phrase is read, and only when it is the very start of the text
		if m := decodeCount.FindStringSubmatch(msg); m != nil {
			return fmt.Sprintf("%s value(s) have an unexpected type (names and values withheld)", m[1])
		}
		return "a value has an unexpected type (names and values withheld)"
	case hjsonPosition.MatchString(msg):
		m := hjsonPosition.FindStringSubmatch(msg)
		return fmt.Sprintf("syntax error at line %s, column %s", m[1], m[2])
	case jsonBytePosition.MatchString(msg):
		return "invalid JSON (a syntax error or a value of the wrong type; position withheld)"
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
