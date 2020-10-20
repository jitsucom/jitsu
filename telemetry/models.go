package telemetry

type InstanceInfo struct {
	Id string `json:"id,omitempty"`

	Commit  string `json:"commit,omitempty"`
	Tag     string `json:"tag,omitempty"`
	BuiltAt string `json:"built_at,omitempty"`
}

type Usage struct {
	ServerStart int    `json:"server_start,omitempty"`
	ServerStop  int    `json:"server_stop,omitempty"`
	Events      uint64 `json:"events,omitempty"`
}

type Errors struct {
	Id       int64 `json:"id,omitempty"`
	Quantity int64 `json:"quantity,omitempty"`
}

type Request struct {
	Timestamp    string        `json:"timestamp,omitempty"`
	InstanceInfo *InstanceInfo `json:"instance_info,omitempty"`
	MetricType   string        `json:"metric_type,omitempty"`
	Usage        *Usage        `json:"usage,omitempty"`
	Errors       *Errors       `json:"errors,omitempty"`
}
