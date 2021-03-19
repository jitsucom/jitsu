package adapters

import (
	"github.com/jitsucom/eventnative/server/events"
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

func (dc *DeleteConditions) IsEmpty() bool {
	return len(dc.Conditions) == 0
}

//DeleteByTimeChunkCondition return delete condition that removes objects based on eventn_ctx_time_interval value
//or empty condition if timeIntervalValue is empty
func DeleteByTimeChunkCondition(timeIntervalValue string) *DeleteConditions {
	if timeIntervalValue == "" {
		return &DeleteConditions{}
	}

	return &DeleteConditions{
		JoinCondition: "AND",
		Conditions:    []DeleteCondition{{Field: events.EventnKey + "_" + events.TimeChunkKey, Clause: "=", Value: timeIntervalValue}},
	}
}
