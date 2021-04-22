package events

func ExtractSrc(event Event) string {
	if event == nil {
		return ""
	}

	src, ok := event[SrcKey]
	if ok {
		srcStr, ok := src.(string)
		if ok {
			return srcStr
		}
	}

	return ""
}
