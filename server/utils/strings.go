package utils

import "strings"

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

// ShortenString returns the first N slice of a string.
func ShortenString(str string, n int) string {
	if len(str) <= n {
		return str
	}
	return str[:n]
}

// ShortenStringWithEllipsis returns the first N slice of a string and ends with ellipsis.
func ShortenStringWithEllipsis(str string, n int) string {
	if len(str) <= n {
		return str
	}
	return str[:n] + "..."
}

// JoinNonEmptyStrings joins strings with separator, but ignoring empty strings
func JoinNonEmptyStrings(sep string, elems ...string) string {
	switch len(elems) {
	case 0:
		return ""
	case 1:
		return elems[0]
	}
	n := len(sep) * (len(elems) - 1)
	for i := 0; i < len(elems); i++ {
		n += len(elems[i])
	}

	var b strings.Builder
	b.Grow(n)
	for _, s := range elems {
		if len(s) > 0 {
			if b.Len() > 0 {
				b.WriteString(sep)
			}
			b.WriteString(s)
		}
	}
	return b.String()
}
