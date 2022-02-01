package meta

import "encoding/json"

//Task is a Redis entity
//some fields are updated using names in Storage (like status updating)
type Task struct {
	ID         string `json:"id,omitempty" redis:"id"`
	SourceType string `json:"source_type" redis:"source_type"`
	Source     string `json:"source,omitempty" redis:"source"`
	Collection string `json:"collection,omitempty" redis:"collection"`
	Priority   int64  `json:"priority,omitempty" redis:"priority"`
	CreatedAt  string `json:"created_at,omitempty" redis:"created_at"`
	StartedAt  string `json:"started_at,omitempty" redis:"started_at"`
	FinishedAt string `json:"finished_at,omitempty" redis:"finished_at"`
	Status     string `json:"status,omitempty" redis:"status"`
}

//TaskLogRecord is a Redis entity
type TaskLogRecord struct {
	Time    string `json:"time,omitempty" redis:"time"`
	System  string `json:"system,omitempty" redis:"system"`
	Message string `json:"message,omitempty" redis:"message"`
	Level   string `json:"level,omitempty" redis:"level"`
}

//Marshal returns serialized JSON object string
func (tlr *TaskLogRecord) Marshal() string {
	b, _ := json.Marshal(tlr)
	return string(b)
}
