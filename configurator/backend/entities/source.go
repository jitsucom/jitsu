package entities

// Source entity is stored in main storage (Firebase or Redis)
type Source struct {
	SourceID   string `firestore:"sourceId" json:"sourceId"`
	SourceType string `firestore:"sourceType" json:"sourceType"`

	Destinations []string `firestore:"destinations" json:"destinations"`
	Schedule     string   `firestore:"schedule" json:"schedule,omitempty"`
	ScheduleTime string   `firestore:"scheduleTime" json:"scheduleTime,omitempty"`

	Collections []interface{}          `firestore:"collections" json:"collections"`
	Config      map[string]interface{} `firestore:"config" json:"config"`
}

// Sources entity is stored in main storage (Firebase or Redis)
type Sources struct {
	Sources []*Source `json:"sources" firestore:"sources"`
}
