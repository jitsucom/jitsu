package events

import "fmt"

func ExtractEventID(event Event) string {
	if event == nil {
		return ""
	}

	//lookup eventn_ctx_event_id string
	eventID, ok := event[EventnKey+"_"+EventIDKey]
	if ok {
		return fmt.Sprintf("%v", eventID)
	}

	//lookup eventn_ctx.event_id
	eventnRaw, ok := event[EventnKey]
	if ok {
		eventnObject, ok := eventnRaw.(map[string]interface{})
		if ok {
			eventID, ok := eventnObject[EventIDKey]
			if ok {
				return fmt.Sprintf("%v", eventID)
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
