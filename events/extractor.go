package events

func ExtractEventId(fact Fact) string {
	if fact == nil {
		return ""
	}

	//lookup eventn_ctx_event_id string
	eventId, ok := fact[eventnKey+"_"+eventIdKey]
	if ok {
		eventIdStr, ok := eventId.(string)
		if ok {
			return eventIdStr
		}
	}

	//lookup eventn_ctx.event_id
	eventnRaw, ok := fact[eventnKey]
	if ok {
		eventnObject, ok := eventnRaw.(map[string]interface{})
		if ok {
			eventId, ok := eventnObject[eventIdKey]
			if ok {
				eventIdStr, ok := eventId.(string)
				if ok {
					return eventIdStr
				}
			}
		}

	}

	return ""
}
