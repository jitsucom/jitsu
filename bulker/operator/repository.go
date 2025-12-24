package main

import (
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"io"
	"slices"
	"strings"
	"sync/atomic"
	"time"

	"github.com/jitsucom/bulker/jitsubase/appbase"
)

// ConnectionsRepositoryData handles rotor-connections repository
type ConnectionsRepositoryData struct {
	data atomic.Pointer[ConnectionsData]
}

type ConnectionsData struct {
	connections  []*EnrichedConnectionConfig
	byWorkspace  map[string][]*EnrichedConnectionConfig
	lastModified time.Time
}

func (c *ConnectionsRepositoryData) Init(reader io.Reader, tag any) error {
	dec := json.NewDecoder(reader)
	_, err := dec.Token() // read open bracket
	if err != nil {
		return fmt.Errorf("error reading open bracket: %v", err)
	}

	connections := make([]*EnrichedConnectionConfig, 0)
	byWorkspace := make(map[string][]*EnrichedConnectionConfig)

	for dec.More() {
		conn := &EnrichedConnectionConfig{}
		err = dec.Decode(conn)
		if err != nil {
			return fmt.Errorf("error unmarshalling connection config: %v", err)
		}
		connections = append(connections, conn)
		byWorkspace[conn.WorkspaceID] = append(byWorkspace[conn.WorkspaceID], conn)
	}

	_, err = dec.Token() // read closing bracket
	if err != nil {
		return fmt.Errorf("error reading closing bracket: %v", err)
	}

	data := &ConnectionsData{
		connections: connections,
		byWorkspace: byWorkspace,
	}
	if tag != nil {
		data.lastModified = tag.(time.Time)
	}
	c.data.Store(data)
	return nil
}

func (c *ConnectionsRepositoryData) GetData() *ConnectionsData {
	return c.data.Load()
}

func (c *ConnectionsRepositoryData) Store(writer io.Writer) error {
	d := c.data.Load()
	if d != nil {
		encoder := json.NewEncoder(writer)
		return encoder.Encode(d.connections)
	}
	return nil
}

// FunctionsRepositoryData handles functions repository
type FunctionsRepositoryData struct {
	data atomic.Pointer[FunctionsData]
}

type FunctionsData struct {
	functions    []*FunctionConfig
	byWorkspace  map[string][]*FunctionConfig
	lastModified time.Time
}

func (f *FunctionsRepositoryData) Init(reader io.Reader, tag any) error {
	dec := json.NewDecoder(reader)
	_, err := dec.Token() // read open bracket
	if err != nil {
		return fmt.Errorf("error reading open bracket: %v", err)
	}

	functions := make([]*FunctionConfig, 0)
	byWorkspace := make(map[string][]*FunctionConfig)

	for dec.More() {
		fn := &FunctionConfig{}
		err = dec.Decode(fn)
		if err != nil {
			return fmt.Errorf("error unmarshalling function config: %v", err)
		}
		functions = append(functions, fn)
		byWorkspace[fn.WorkspaceID] = append(byWorkspace[fn.WorkspaceID], fn)
	}

	_, err = dec.Token() // read closing bracket
	if err != nil {
		return fmt.Errorf("error reading closing bracket: %v", err)
	}

	data := &FunctionsData{
		functions:   functions,
		byWorkspace: byWorkspace,
	}
	if tag != nil {
		data.lastModified = tag.(time.Time)
	}
	f.data.Store(data)
	return nil
}

func (f *FunctionsRepositoryData) GetData() *FunctionsData {
	return f.data.Load()
}

func (f *FunctionsRepositoryData) Store(writer io.Writer) error {
	d := f.data.Load()
	if d != nil {
		encoder := json.NewEncoder(writer)
		return encoder.Encode(d.functions)
	}
	return nil
}

// WorkspacesRepositoryData handles workspaces repository
type WorkspacesRepositoryData struct {
	data atomic.Pointer[WorkspacesData]
}

type WorkspacesData struct {
	workspaces   []*WorkspaceConfig
	byID         map[string]*WorkspaceConfig
	lastModified time.Time
}

func (w *WorkspacesRepositoryData) Init(reader io.Reader, tag any) error {
	dec := json.NewDecoder(reader)
	_, err := dec.Token() // read open bracket
	if err != nil {
		return fmt.Errorf("error reading open bracket: %v", err)
	}

	workspaces := make([]*WorkspaceConfig, 0)
	byID := make(map[string]*WorkspaceConfig)

	for dec.More() {
		ws := &WorkspaceConfig{}
		err = dec.Decode(ws)
		if err != nil {
			return fmt.Errorf("error unmarshalling workspace config: %v", err)
		}
		workspaces = append(workspaces, ws)
		byID[ws.ID] = ws
	}

	_, err = dec.Token() // read closing bracket
	if err != nil {
		return fmt.Errorf("error reading closing bracket: %v", err)
	}

	data := &WorkspacesData{
		workspaces: workspaces,
		byID:       byID,
	}
	if tag != nil {
		data.lastModified = tag.(time.Time)
	}
	w.data.Store(data)
	return nil
}

func (w *WorkspacesRepositoryData) GetData() *WorkspacesData {
	return w.data.Load()
}

func (w *WorkspacesRepositoryData) Store(writer io.Writer) error {
	d := w.data.Load()
	if d != nil {
		encoder := json.NewEncoder(writer)
		return encoder.Encode(d.workspaces)
	}
	return nil
}

// Repository factory functions
func NewConnectionsRepository(baseURL, token string, refreshPeriodSec int, cacheDir string) appbase.Repository[ConnectionsData] {
	url := fmt.Sprintf("%s/rotor-connections", baseURL)
	return appbase.NewHTTPRepository[ConnectionsData]("rotor-connections", url, token, appbase.HTTPTagLastModified, &ConnectionsRepositoryData{}, 1, refreshPeriodSec, cacheDir)
}

func NewFunctionsRepository(baseURL, token string, refreshPeriodSec int, cacheDir string) appbase.Repository[FunctionsData] {
	url := fmt.Sprintf("%s/functions", baseURL)
	return appbase.NewHTTPRepository[FunctionsData]("functions", url, token, appbase.HTTPTagLastModified, &FunctionsRepositoryData{}, 1, refreshPeriodSec, cacheDir)
}

func NewWorkspacesRepository(baseURL, token string, refreshPeriodSec int, cacheDir string) appbase.Repository[WorkspacesData] {
	url := fmt.Sprintf("%s/workspaces", baseURL)
	return appbase.NewHTTPRepository[WorkspacesData]("workspaces", url, token, appbase.HTTPTagLastModified, &WorkspacesRepositoryData{}, 1, refreshPeriodSec, cacheDir)
}

// Helper functions for aggregating workspace data
func CalculateWorkspaceData(
	workspaceID string,
	connections []*EnrichedConnectionConfig,
	functions []*FunctionConfig,
	hasDedicatedFS bool,
) *WorkspaceData {
	var maxUpdatedAt time.Time
	var usesWarehouseAPI bool

	for _, fn := range functions {
		if fn.UpdatedAt.After(maxUpdatedAt) {
			maxUpdatedAt = fn.UpdatedAt
			if !usesWarehouseAPI && strings.Contains(fn.Code, "getWarehouse") {
				usesWarehouseAPI = true
			}
		}
	}
	filteredConnections := make([]*EnrichedConnectionConfig, 0, len(connections))
	for _, conn := range connections {
		if !usesWarehouseAPI && conn.ID == conn.StreamID && conn.ID == conn.DestinationID {
			// Skip bulker-internal connections unless warehouse API is used
			continue
		}
		filteredConnections = append(filteredConnections, conn)
		if conn.UpdatedAt != nil && conn.UpdatedAt.After(maxUpdatedAt) {
			maxUpdatedAt = *conn.UpdatedAt
		}
	}

	// Calculate config hash for change detection
	configHash := CalculateConfigHash(connections, functions)

	return &WorkspaceData{
		WorkspaceID:      workspaceID,
		MaxUpdatedAt:     maxUpdatedAt,
		Connections:      filteredConnections,
		Functions:        functions,
		UsesWarehouseAPI: usesWarehouseAPI,
		HasDedicatedFS:   hasDedicatedFS,
		ConfigHash:       configHash,
	}
}

func CalculateConfigHash(connections []*EnrichedConnectionConfig, functions []*FunctionConfig) string {
	h := sha256.New()

	// Sort and hash connections
	connIDs := make([]string, 0, len(connections))
	connMap := make(map[string]*EnrichedConnectionConfig)
	for _, conn := range connections {
		connIDs = append(connIDs, conn.ID)
		connMap[conn.ID] = conn
	}
	slices.Sort(connIDs)

	for _, id := range connIDs {
		conn := connMap[id]
		h.Write([]byte(conn.ID))
		h.Write([]byte(conn.OptionsHash))
		h.Write([]byte(conn.CredentialsHash))
		//if conn.UpdatedAt != nil {
		//	h.Write([]byte(conn.UpdatedAt.Format(time.RFC3339)))
		//}
	}

	// Sort and hash functions
	fnIDs := make([]string, 0, len(functions))
	fnMap := make(map[string]*FunctionConfig)
	for _, fn := range functions {
		fnIDs = append(fnIDs, fn.ID)
		fnMap[fn.ID] = fn
	}
	slices.Sort(fnIDs)

	for _, id := range fnIDs {
		fn := fnMap[id]
		h.Write([]byte(fn.ID))
		h.Write([]byte(fn.CodeHash))
		//h.Write([]byte(fn.UpdatedAt.Format(time.RFC3339)))
	}

	return hex.EncodeToString(h.Sum(nil))[:16]
}
