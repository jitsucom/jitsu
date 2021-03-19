package entities

//ApiKey entity is stored in main storage (Firebase)
type ApiKey struct {
	Id           string   `firestore:"uid" json:"uid" yaml:"id,omitempty"`
	ClientSecret string   `firestore:"jsAuth" json:"jsAuth" yaml:"client_secret,omitempty"`
	ServerSecret string   `firestore:"serverAuth" json:"serverAuth" yaml:"server_secret,omitempty"`
	Origins      []string `firestore:"origins" json:"origins" yaml:"origins,omitempty"`
}

//ApiKeys entity is stored in main storage (Firebase)
type ApiKeys struct {
	Keys []*ApiKey `firestore:"keys" json:"keys" yaml:"keys,omitempty"`
}
