package utils

import (
	"fmt"
	"regexp"
)

var nonAlphanumericRegex = regexp.MustCompile(`[^a-zA-Z0-9_]+`)

// NvlString returns first not empty string value from varargs
//
// return "" if all strings are empty
func NvlString(args ...string) string {
	for _, str := range args {
		if str != "" {
			return str
		}
	}
	return ""
}

func DefaultString(str, defaultValue string) string {
	if str == "" {
		return defaultValue
	}
	return str
}

func DefaultStringFunc(str string, f func() string) string {
	if str == "" {
		return f()
	}
	return str
}

// ShortenString returns the first N slice of a string.
func ShortenString(str string, n int) string {
	runes := []rune(str)
	if len(runes) <= n {
		return str
	}
	return string(runes[:n])
}

// ShortenString returns the first N slice of a string and a flag indicating if the string was shortened.
func ShortenString2(str string, n int) (string, bool) {
	runes := []rune(str)
	if len(runes) <= n {
		return str, false
	}
	return string(runes[:n]), true
}

// ShortenStringWithEllipsis returns the first N slice of a string and ends with ellipsis.
func ShortenStringWithEllipsis(str string, n int) string {
	runes := []rune(str)
	if len(runes) <= n {
		return str
	}
	return string(runes[:n]) + "..."
}

func ShortenStringWithEllipsisMiddle(str string, n int, ellipsis string) string {
	runes := []rune(str)
	if len(runes) <= n {
		return str
	}
	if ellipsis == "" {
		ellipsis = "..."
	}
	return string(runes[:n/2]) + ellipsis + string(runes[len(runes)-n/2:])
}

// IsLetterOrNumber returns true if input symbol is:
//
//	A - Z: 65-90
//	a - z: 97-122
func IsLetterOrNumber(symbol int32) bool {
	return ('a' <= symbol && symbol <= 'z') ||
		('A' <= symbol && symbol <= 'Z') ||
		('0' <= symbol && symbol <= '9')
}

func IsLowerLetterOrNumber(symbol int32) bool {
	return ('a' <= symbol && symbol <= 'z') ||
		('0' <= symbol && symbol <= '9')
}

func IsLetterOrUnderscore(symbol int32) bool {
	return ('a' <= symbol && symbol <= 'z') ||
		('A' <= symbol && symbol <= 'Z') || symbol == '_'
}

func IsLowerLetterOrUnderscore(symbol int32) bool {
	return ('a' <= symbol && symbol <= 'z') || symbol == '_'
}

func IsNumber(symbol int32) bool {
	return '0' <= symbol && symbol <= '9'
}

func IsAlphanumeric(str string) bool {
	for _, symbol := range str {
		if !IsLetterOrNumber(symbol) && symbol != '_' {
			return false
		}
	}
	return true
}

func IsLowerAlphanumeric(str string) bool {
	for _, symbol := range str {
		if !IsLowerLetterOrNumber(symbol) && symbol != '_' {
			return false
		}
	}
	return true
}

func IsSameSymbol(str string, symbol int32) bool {
	for _, s := range str {
		if s != symbol {
			return false
		}
	}
	return true

}

// SanitizeString returns string with only alphanumeric characters and underscores
func SanitizeString(str string) string {
	return nonAlphanumericRegex.ReplaceAllString(str, "_")
}

// JoinNonEmptyStrings joins strings with separator, but ignoring empty strings
func JoinNonEmptyStrings(sep, elem1, elem2 string) string {
	if elem1 == "" {
		return elem2
	} else if elem2 == "" {
		return elem1
	} else {
		return elem1 + sep + elem2
	}
}

// ParseString parses value of string - effectively strict type checking.
func ParseString(value any) (string, error) {
	switch v := value.(type) {
	case string:
		return v, nil
	default:
		return "", fmt.Errorf("ParseString: invalid value type %T", value)
	}
}
