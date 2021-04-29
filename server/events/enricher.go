package events

import (
	"github.com/jitsucom/jitsu/server/timestamp"
	"time"
)

const (
	//SrcKey is a system field
	SrcKey = "src"
	//TimeChunkKey is a system field
	TimeChunkKey      = "_time_interval"
	timeIntervalStart = "_interval_start"
	timeIntervalEnd   = "_interval_end"
	collectionIDKey   = "_collection_id"
)

//EnrichWithCollection puts collection string to object
func EnrichWithCollection(object map[string]interface{}, collection string) {
	object[collectionIDKey] = collection
}

//EnrichWithTimeInterval puts interval representation to object
func EnrichWithTimeInterval(object map[string]interface{}, interval string, lower, upper time.Time) {
	object[TimeChunkKey] = interval
	object[timeIntervalStart] = timestamp.ToISOFormat(lower)
	object[timeIntervalEnd] = timestamp.ToISOFormat(upper)
}
