package utils

//NvlString returns first not empty string value from varargs
//
//return "" if all strings are empty
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
