package entities

// APIKey entity is stored in main storage (Firebase)
type APIKey struct {
	ID             string   `firestore:"uid" json:"uid" yaml:"id,omitempty"`
	ClientSecret   string   `firestore:"jsAuth" json:"jsAuth" yaml:"client_secret,omitempty"`
	ServerSecret   string   `firestore:"serverAuth" json:"serverAuth" yaml:"server_secret,omitempty"`
	Origins        []string `firestore:"origins" json:"origins" yaml:"origins,omitempty"`
	BatchPeriodMin int      `firestore:"batchPeriodMin" json:"batchPeriodMin" yaml:"batchPeriodMin,omitempty"`
}

// APIKeys entity is stored in main storage (Firebase)
type APIKeys struct {
	Keys []*APIKey `firestore:"keys" json:"keys" yaml:"keys,omitempty"`
}
