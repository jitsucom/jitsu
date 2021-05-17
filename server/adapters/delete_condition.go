package adapters

import (
	"github.com/jitsucom/jitsu/server/events"
)

//DeleteCondition is a representation of SQL delete condition
type DeleteCondition struct {
	Field  string
	Value  interface{}
	Clause string
}

//DeleteConditions is a dto for multiple DeleteCondition instances with Joiner
type DeleteConditions struct {
	Conditions    []DeleteCondition
	JoinCondition string
}

//IsEmpty returns true if there is no conditions
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
		Conditions:    []DeleteCondition{{Field: events.TimeChunkKey, Clause: "=", Value: timeIntervalValue}},
	}
}
