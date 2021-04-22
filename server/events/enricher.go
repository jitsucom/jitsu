package events

import (
	"github.com/jitsucom/jitsu/server/timestamp"
	"time"
)

const (
	//EventnKey is used as a prefix in system fields in Sources functionality
	EventnKey       = "eventn_ctx"
	collectionIDKey = "collection_id"
	TimeChunkKey    = "time_interval"

	SrcKey = "src"
)

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
