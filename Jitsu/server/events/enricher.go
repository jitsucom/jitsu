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
	SourceIDKey       = "_source_id"
)

// EnrichWithCollection puts collection string to object
func EnrichWithCollection(object map[string]interface{}, collection string) {
	object[CollectionIDKey] = collection
}

// EnrichWithSourceId puts source id string to object
func EnrichWithSourceId(object map[string]interface{}, sourceId string) {
	object[SourceIDKey] = sourceId
}

// EnrichWithTimeInterval puts interval representation to object
func EnrichWithTimeInterval(object map[string]interface{}, interval string, lower, upper time.Time) {
	object[TimeChunkKey] = interval
	if !lower.IsZero() {
		object[TimeIntervalStart] = timestamp.ToISOFormat(lower)
	}
	if !upper.IsZero() {
		object[TimeIntervalEnd] = timestamp.ToISOFormat(upper)
	}
}
