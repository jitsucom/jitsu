package utils

//NvlString returns first not empty string value from varargs
//
//return "" if all strings are empty
func NvlString(args ... string) string {
	for _, str := range args {
		if str != "" {
			return str
		}
	}
	return ""
}
