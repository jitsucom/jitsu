package entities

//GeoDataResolver is an entity which is stored in main storage (Firebase or Redis)
type GeoDataResolver struct {
	MaxMind *MaxMind `firestore:"maxmind" json:"maxmind"`
}

//MaxMind is an entity which is stored in main storage (Firebase or Redis)
type MaxMind struct {
	Enabled    bool   `firestore:"enabled" json:"enabled"`
	LicenseKey string `firestore:"license_key" json:"license_key"`
}
