package events

import "fmt"

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
