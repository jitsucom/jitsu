package meta

type Event struct {
	Original string `json:"original,omitempty"`
	Success  string `json:"success,omitempty"`
	Error    string `json:"error,omitempty"`
}
