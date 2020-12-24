package adapters

import (
	"github.com/jitsucom/eventnative/events"
)

type DeleteCondition struct {
	Field  string
	Value  interface{}
	Clause string
}

type DeleteConditions struct {
	Conditions    []DeleteCondition
	JoinCondition string
}

// Returns delete condition that removes objects based on eventn_ctx_time_interval value
func DeleteByTimeChunkCondition(timeIntervalValue string) *DeleteConditions {
	return &DeleteConditions{
		JoinCondition: "AND",
		Conditions:    []DeleteCondition{{Field: events.EventnKey + "_" + events.TimeChunkKey, Clause: "=", Value: timeIntervalValue}},
	}
}
