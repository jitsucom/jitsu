package main

import (
	"time"
)

// FunctionConfig represents a user-defined function configuration
type FunctionConfig struct {
	ID          string    `json:"id"`
	CreatedAt   time.Time `json:"createdAt"`
	UpdatedAt   time.Time `json:"updatedAt"`
	WorkspaceID string    `json:"workspaceId"`
	Name        string    `json:"name"`
	Code        string    `json:"code"`
	CodeHash    string    `json:"codeHash"`
}

// EnrichedConnectionConfig represents a rotor connection configuration
type EnrichedConnectionConfig struct {
	ID               string         `json:"id"`
	WorkspaceID      string         `json:"workspaceId"`
	Special          string         `json:"special,omitempty"`
	UpdatedAt        *time.Time     `json:"updatedAt,omitempty"`
	DestinationID    string         `json:"destinationId"`
	StreamID         string         `json:"streamId"`
	StreamName       string         `json:"streamName,omitempty"`
	MetricsKeyPrefix string         `json:"metricsKeyPrefix"`
	UsesBulker       bool           `json:"usesBulker"`
	Type             string         `json:"type"`
	Options          map[string]any `json:"options"`
	OptionsHash      string         `json:"optionsHash"`
	Credentials      map[string]any `json:"credentials"`
	CredentialsHash  string         `json:"credentialsHash"`
}

// WorkspaceConfig represents a workspace configuration
type WorkspaceConfig struct {
	ID              string    `json:"id"`
	CreatedAt       time.Time `json:"createdAt"`
	UpdatedAt       time.Time `json:"updatedAt"`
	Name            string    `json:"name"`
	Slug            string    `json:"slug"`
	FeaturesEnabled []string  `json:"featuresEnabled"`
}

// WorkspaceData holds aggregated data for a workspace
type WorkspaceData struct {
	WorkspaceID             string
	MaxUpdatedAt            time.Time
	Connections             []*EnrichedConnectionConfig
	Functions               []*FunctionConfig
	HasDedicatedFS          bool
	ConfigHash              string // Hash of connections + functions for change detection
	FunctionsConfigMapCount int    // Number of functions ConfigMaps (for splitting large data)
}
