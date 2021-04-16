package telemetry

//InstanceInfo is a deploed server data dto
type InstanceInfo struct {
	ID string `json:"id,omitempty"`

	Commit      string `json:"commit,omitempty"`
	Tag         string `json:"tag,omitempty"`
	BuiltAt     string `json:"built_at,omitempty"`
	ServiceName string `json:"service,omitempty"`
	RunID       string `json:"run_id,omitempty"`
}

//Usage is a usage accounting dto
type Usage struct {
	ServerStart int `json:"server_start,omitempty"`
	ServerStop  int `json:"server_stop,omitempty"`

	Events    uint64 `json:"events,omitempty"`
	Errors    uint64 `json:"errors,omitempty"`
	EventsSrc string `json:"events_src"`

	Source     string `json:"hashed_source_id"`
	SourceType string `json:"source_type"`

	Destination     string `json:"hashed_destination_id"`
	DestinationType string `json:"destination_type"`
	DestinationMode string `json:"destination_mode"`

	Coordination string `json:"coordination"`
}

//Errors is a error accounting dto
type Errors struct {
	ID       int64 `json:"id,omitempty"`
	Quantity int64 `json:"quantity,omitempty"`
}

//UserData is a registered user data dto
type UserData struct {
	Email       string `json:"email,omitempty"`
	Name        string `json:"name,omitempty"`
	Company     string `json:"company,omitempty"`
	EmailOptout bool   `json:"email_optout"`
	UsageOptout bool   `json:"telemetry_usage_optout"`
}

//Request is a telemetry request dto
type Request struct {
	Timestamp    string        `json:"timestamp,omitempty"`
	InstanceInfo *InstanceInfo `json:"instance_info,omitempty"`
	MetricType   string        `json:"metric_type,omitempty"`
	Usage        *Usage        `json:"usage,omitempty"`
	Errors       *Errors       `json:"errors,omitempty"`
	User         *UserData     `json:"user,omitempty"`
}
