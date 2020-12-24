package events

import "github.com/jitsucom/eventnative/drivers"

const (
	EventnKey       = "eventn_ctx"
	collectionIdKey = "collection_id"
	TimeChunkKey    = "time_interval"

	EventIdKey = "event_id"
)

func EnrichWithEventId(object map[string]interface{}, eventId string) {
	eventnObject, ok := object[EventnKey]
	if !ok {
		eventnObject = map[string]interface{}{EventIdKey: eventId}
		object[EventnKey] = eventnObject
	} else {
		if eventn, ok := eventnObject.(map[string]interface{}); ok {
			if _, ok := eventn[EventIdKey]; !ok {
				eventn[EventIdKey] = eventId
			}
		} else {
			object[EventnKey+"_"+EventIdKey] = eventId
		}
	}
}

func EnrichWithCollection(object map[string]interface{}, collection string) {
	eventnObject, ok := object[EventnKey]
	if !ok {
		eventnObject = map[string]interface{}{collectionIdKey: collection}
		object[EventnKey] = eventnObject
	} else {
		if eventn, ok := eventnObject.(map[string]interface{}); ok {
			if _, ok := eventn[collectionIdKey]; !ok {
				eventn[collectionIdKey] = collection
			}
		} else {
			object[EventnKey+"_"+collectionIdKey] = collection
		}
	}
}

func EnrichWithTimeInterval(object map[string]interface{}, interval *drivers.TimeInterval) {
	object[EventnKey+"_"+TimeChunkKey] = interval.String()
}
