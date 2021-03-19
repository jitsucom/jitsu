package meta

import "encoding/json"

type Task struct {
	ID         string `json:"id,omitempty" redis:"id"`
	Source     string `json:"source,omitempty" redis:"source"`
	Collection string `json:"collection,omitempty" redis:"collection"`
	Priority   int64  `json:"priority,omitempty" redis:"priority"`
	CreatedAt  string `json:"created_at,omitempty" redis:"created_at"`
	StartedAt  string `json:"started_at,omitempty" redis:"started_at"`
	FinishedAt string `json:"finished_at,omitempty" redis:"finished_at"`
	Status     string `json:"status,omitempty" redis:"status"`
}

type TaskLogRecord struct {
	Time    string `json:"time,omitempty" redis:"time"`
	Message string `json:"message,omitempty" redis:"message"`
	Level   string `json:"level,omitempty" redis:"level"`
}

func (tlr *TaskLogRecord) Marshal() string {
	b, _ := json.Marshal(tlr)
	return string(b)
}
