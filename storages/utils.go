package storages

import (
	"bytes"
	"github.com/jitsucom/eventnative/adapters"
	"github.com/jitsucom/eventnative/events"
)

//return rows count from byte array
func linesCount(s []byte) int {
	nl := []byte{'\n'}
	n := bytes.Count(s, nl)
	if len(s) > 0 && !bytes.HasSuffix(s, nl) {
		n++
	}
	return n
}

// Returns delete condition that removes objects based on eventn_ctx_time_interval value
func deleteByTimeChunkCondition(timeIntervalValue string) *adapters.DeleteConditions {
	return &adapters.DeleteConditions{
		JoinCondition: "AND",
		Conditions:    []adapters.DeleteCondition{{Field: events.EventnKey + "_" + events.TimeChunkKey, Clause: "=", Value: timeIntervalValue}},
	}
}
