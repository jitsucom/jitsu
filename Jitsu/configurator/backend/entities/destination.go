package entities

import "github.com/jitsucom/jitsu/server/enrichment"

// Destination entity is stored in main storage (Firebase or Redis)
type Destination struct {
	ID                             string                   `firestore:"_id" json:"_id"`
	UID                            string                   `firestore:"_uid" json:"_uid"`
	Type                           string                   `firestore:"_type"  json:"_type"`
	SuperType                      string                   `firestore:"_super_type"  json:"_super_type"`
	Package                        string                   `firestore:"_package"  json:"_package"`
	Data                           interface{}              `firestore:"_formData" json:"_formData"`
	TransformEnabled               *bool                    `firestore:"_transform_enabled,omitempty"  json:"_transform_enabled,omitempty"`
	StreamingThreadsCount          int                      `firestore:"_streaming_threads_count,omitempty"  json:"_streaming_threads_count,omitempty"`
	Transform                      string                   `firestore:"_transform"  json:"_transform"`
	Mappings                       *Mappings                `firestore:"_mappings" json:"_mappings"`
	Enrichment                     []*enrichment.RuleConfig `firestore:"_enrichment" json:"_enrichment"`
	UsersRecognition               *UsersRecognition        `firestore:"_users_recognition" json:"_users_recognition"`
	OnlyKeys                       []string                 `firestore:"_onlyKeys" json:"_onlyKeys"`
	PrimaryKeyFields               []string                 `firestore:"_primary_key_fields" json:"_primary_key_fields"`
	CachingConfiguration           *CachingConfiguration    `firestore:"_caching_configuration" json:"_caching_configuration"`
	DisableDefaultPrimaryKeyFields bool                     `firestore:"_disable_default_primary_key_fields" json:"_disable_default_primary_key_fields"`
}

// Destinations entity is stored in main storage (Firebase or Redis)
type Destinations struct {
	Destinations []*Destination `json:"destinations" firestore:"destinations"`
}

// Mappings entity is stored in main storage (Firebase or Redis)
type Mappings struct {
	KeepFields bool      `firestore:"_keepUnmappedFields" json:"_keepUnmappedFields"`
	Rules      []MapRule `firestore:"_mappings" json:"_mappings"`
}

// UsersRecognition entity is stored in main storage (Firebase or Redis)
type UsersRecognition struct {
	Enabled         bool   `firestore:"_enabled" json:"_enabled"`
	AnonymousIDNode string `firestore:"_anonymous_id_node" json:"_anonymous_id_node"`
	UserIDJSONNode  string `firestore:"_user_id_node" json:"_user_id_node"`
}

// CachingConfiguration entity is stored in main storage (Firebase or Redis)
type CachingConfiguration struct {
	Disabled bool `firestore:"_disabled" json:"_disabled"`
}

// IsEmpty returns true if mappings is empty
func (m *Mappings) IsEmpty() bool {
	return m == nil || len(m.Rules) == 0
}

// MapRule entity is stored in main storage (Firebase or Redis)
type MapRule struct {
	Action           string      `firestore:"_action" json:"_action"`
	SourceField      string      `firestore:"_srcField" json:"_srcField"`
	DestinationField string      `firestore:"_dstField" json:"_dstField"`
	Type             string      `firestore:"_type" json:"_type"`
	ColumnType       string      `firestore:"_columnType" json:"_columnType"`
	Value            interface{} `firestore:"_value" json:"_value"`
}
