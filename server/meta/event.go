package meta

type Event struct {
	Original string `json:"original,omitempty" redis:"original"`
	Success  string `json:"success,omitempty" redis:"success"`
	Error    string `json:"error,omitempty" redis:"error"`
}

type EventsPerTime struct {
	Key    string `json:"key"`
	Events int    `json:"events"`
}
