package events

import "fmt"

func ExtractEventId(event Event) string {
	if event == nil {
		return ""
	}

	//lookup eventn_ctx_event_id string
	eventId, ok := event[EventnKey+"_"+EventIdKey]
	if ok {
		return fmt.Sprintf("%v", eventId)
	}

	//lookup eventn_ctx.event_id
	eventnRaw, ok := event[EventnKey]
	if ok {
		eventnObject, ok := eventnRaw.(map[string]interface{})
		if ok {
			eventId, ok := eventnObject[EventIdKey]
			if ok {
				return fmt.Sprintf("%v", eventId)
			}
		}

	}

	return ""
}

func ExtractSrc(event Event) string {
	if event == nil {
		return ""
	}

	src, ok := event["src"]
	if ok {
		srcStr, ok := src.(string)
		if ok {
			return srcStr
		}
	}

	return ""
}
