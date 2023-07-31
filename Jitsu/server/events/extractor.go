package events

import "fmt"

//ExtractSrc returns 'src' field from input event or an empty string
func ExtractSrc(event Event) string {
	if event == nil {
		return ""
	}

	src, ok := event[SrcKey]
	if ok {
		return fmt.Sprint(src)
	}

	return ""
}
