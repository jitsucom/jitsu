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
	UsesWarehouseAPI        bool
	FunctionsClass          string // premium, dedicated, free
	ConfigHash              string // Hash of connections + functions for change detection
	FunctionsConfigMapCount int    // Number of functions ConfigMaps (for splitting large data)
}

// DeploymentData holds aggregated data for a deployment (can contain multiple workspaces)
type DeploymentData struct {
	DeploymentID              string   // Deployment identifier (workspaceID for dedicated, "free" for free tier)
	FunctionsClass            string   // dedicated, free, or legacy
	WorkspaceIDs              []string // List of workspace IDs in this deployment
	Connections               []*EnrichedConnectionConfig
	Functions                 []*FunctionConfig
	ConfigHash                string // Hash of all connections + functions for change detection
	OperatorConfigHash        string // Hash of operator Config for detecting config changes
	ConnectionsConfigMapCount int    // Number of connections ConfigMaps (for splitting large data)
	FunctionsConfigMapCount   int    // Number of functions ConfigMaps (for splitting large data)
	Replicas                  *int32 // Current replicas from live deployment (used to preserve HPA-managed value)
}
