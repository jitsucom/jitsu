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
	TimeIntervalStart = "_interval_start"
	TimeIntervalEnd   = "_interval_end"
	CollectionIDKey   = "_collection_id"
)

//EnrichWithCollection puts collection string to object
func EnrichWithCollection(object map[string]interface{}, collection string) {
	object[CollectionIDKey] = collection
}

//EnrichWithTimeInterval puts interval representation to object
func EnrichWithTimeInterval(object map[string]interface{}, interval string, lower, upper time.Time) {
	object[TimeChunkKey] = interval
	object[TimeIntervalStart] = timestamp.ToISOFormat(lower)
	object[TimeIntervalEnd] = timestamp.ToISOFormat(upper)
}
