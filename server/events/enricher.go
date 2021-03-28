package events

import (
	"github.com/jitsucom/jitsu/server/timestamp"
	"time"
)

const (
	EventnKey       = "eventn_ctx"
	collectionIDKey = "collection_id"
	TimeChunkKey    = "time_interval"

	EventIDKey = "event_id"

	EventnCtxEventID = "eventn_ctx_event_id"
)

//EnrichWithEventID put eventID to EventnKey_EventIDKey key if it doesn't exist there or if there is an empty string
func EnrichWithEventID(object map[string]interface{}, eventID string) {
	eventnObject, ok := object[EventnKey]
	if !ok {
		eventnObject = map[string]interface{}{EventIDKey: eventID}
		object[EventnKey] = eventnObject
	} else {
		if eventn, ok := eventnObject.(map[string]interface{}); ok {
			val, ok := eventn[EventIDKey]
			if !ok || val == "" {
				eventn[EventIDKey] = eventID
			}
		} else {
			object[EventnCtxEventID] = eventID
		}
	}
}

func EnrichWithCollection(object map[string]interface{}, collection string) {
	eventnObject, ok := object[EventnKey]
	if !ok {
		eventnObject = map[string]interface{}{collectionIDKey: collection}
		object[EventnKey] = eventnObject
	} else {
		if eventn, ok := eventnObject.(map[string]interface{}); ok {
			if _, ok := eventn[collectionIDKey]; !ok {
				eventn[collectionIDKey] = collection
			}
		} else {
			object[EventnKey+"_"+collectionIDKey] = collection
		}
	}
}

func EnrichWithTimeInterval(object map[string]interface{}, interval string, lower, upper time.Time) {
	object[EventnKey+"_"+TimeChunkKey] = interval
	object[EventnKey+"_interval_start"] = timestamp.ToISOFormat(lower)
	object[EventnKey+"_interval_end"] = timestamp.ToISOFormat(upper)
}
