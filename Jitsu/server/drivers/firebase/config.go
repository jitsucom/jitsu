package firebase

import (
	"errors"
	"strings"
)

// FirebaseConfig is a Firebase configuration dto for serialization
type FirebaseConfig struct {
	ProjectID     string `mapstructure:"project_id" json:"project_id,omitempty" yaml:"project_id,omitempty"`
	Credentials   string `mapstructure:"key" json:"key,omitempty" yaml:"key,omitempty"`
	ReplaceTables bool   `mapstructure:"replace_tables" json:"replace_tables,omitempty" yaml:"replace_tables,omitempty"`
}

// Validate returns err if configuration is invalid
func (fc *FirebaseConfig) Validate() error {
	if fc == nil {
		return errors.New("firebase config is required")
	}
	if fc.ProjectID == "" {
		return errors.New("project_id is not set")
	}
	if fc.Credentials == "" || !strings.HasPrefix(fc.Credentials, "{") {
		return errors.New("credentials must be a valid JSON")
	}
	return nil
}

// FirestoreParameters is a Firebase Firestore configuration dto for serialization
type FirestoreParameters struct {
	FirestoreCollection string `mapstructure:"collection" json:"collection,omitempty" yaml:"collection,omitempty"`
}

// Validate returns err if configuration is invalid
func (fp *FirestoreParameters) Validate() error {
	if fp == nil {
		return errors.New("'parameters' section is required")
	}
	if fp.FirestoreCollection == "" {
		return errors.New("'collection' is required firebase parameter")
	}
	return nil
}
