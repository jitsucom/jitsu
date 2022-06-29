package entities

type CustomDomain struct {
	Name   string `firestore:"name" json:"name"`
	Status string `firestore:"status" json:"status"`
}

type CustomDomains struct {
	CertificateExpirationDate string          `firestore:"_certificateExpiration" json:"_certificateExpiration"`
	Certificate               string          `firestore:"certificate" json:"certificate"`
	PrivateKey                string          `firestore:"privateKey" json:"privateKey"`
	Domains                   []*CustomDomain `firestore:"domains" json:"domains"`
}
