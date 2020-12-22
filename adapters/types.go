package adapters

import (
	"fmt"
	"strings"
)

type DeleteCondition struct {
	Field  string
	Value  interface{}
	Clause string
}

func (dc *DeleteCondition) ToQueryString() string {
	var value string
	switch dc.Value.(type) {
	case string:
		value = fmt.Sprintf("'%s'", dc.Value)
	default:
		value = fmt.Sprint(dc.Value)
	}
	return dc.Field + " " + dc.Clause + value
}

type DeleteConditions struct {
	Conditions    []DeleteCondition
	JoinCondition string
}

func (dcs *DeleteConditions) ToQueryString() string {
	var queryConditions []string
	for _, condition := range dcs.Conditions {
		queryConditions = append(queryConditions, condition.ToQueryString())
	}
	return strings.Join(queryConditions, " "+dcs.JoinCondition+" ")
}
