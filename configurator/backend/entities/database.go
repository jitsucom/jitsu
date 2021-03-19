package entities

//Database entity is stored in main storage (Firebase)
type Database struct {
	Host     string `firestore:"Host" json:"Host"`
	Port     int    `firestore:"Port" json:"Port"`
	Database string `firestore:"Database" json:"Database"`
	User     string `firestore:"User" json:"User"`
	Password string `firestore:"Password" json:"Password"`
}
