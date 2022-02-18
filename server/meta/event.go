package meta

type Event struct {
	Original      string `json:"original,omitempty" redis:"original"`
	Success       string `json:"success,omitempty" redis:"success"`
	Error         string `json:"error,omitempty" redis:"error"`
	Skip          string `json:"skip,omitempty" redis:"skip"`
	DestinationID string `json:"destination_id,omitempty" redis:"destination_id"`
	TokenID       string `json:"token_id,omitempty" redis:"token_id"`
}

type EventsPerTime struct {
	Key    string `json:"key"`
	Events int    `json:"events"`
}
