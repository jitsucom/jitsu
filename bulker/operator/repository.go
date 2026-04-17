package main

import (
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"io"
	"slices"
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

// WorkspacesRepositoryData handles workspaces-with-profiles repository.
// Parses both workspace configs and profile builders from the same endpoint.
type WorkspacesRepositoryData struct {
	data atomic.Pointer[WorkspacesData]
}

type WorkspacesData struct {
	workspaces          []*WorkspaceConfig
	byID                map[string]*WorkspaceConfig
	profileBuildersByWs map[string][]*ProfileBuilderConfig
	lastModified        time.Time
}

// workspaceWithProfiles is used for JSON unmarshalling of the workspaces-with-profiles export
type workspaceWithProfiles struct {
	WorkspaceConfig
	ProfileBuilders []*ProfileBuilderConfig `json:"profileBuilders"`
}

func (w *WorkspacesRepositoryData) Init(reader io.Reader, tag any) error {
	dec := json.NewDecoder(reader)
	_, err := dec.Token() // read open bracket
	if err != nil {
		return fmt.Errorf("error reading open bracket: %v", err)
	}

	workspaces := make([]*WorkspaceConfig, 0)
	byID := make(map[string]*WorkspaceConfig)
	profileBuildersByWs := make(map[string][]*ProfileBuilderConfig)

	for dec.More() {
		ws := &workspaceWithProfiles{}
		err = dec.Decode(ws)
		if err != nil {
			return fmt.Errorf("error unmarshalling workspace config: %v", err)
		}
		wsCfg := &ws.WorkspaceConfig
		workspaces = append(workspaces, wsCfg)
		byID[wsCfg.ID] = wsCfg

		// Extract active profile builders (version > 0)
		if len(ws.ProfileBuilders) > 0 {
			active := make([]*ProfileBuilderConfig, 0, len(ws.ProfileBuilders))
			for _, pb := range ws.ProfileBuilders {
				if pb.Version > 0 {
					pb.WorkspaceID = wsCfg.ID
					active = append(active, pb)
				}
			}
			if len(active) > 0 {
				profileBuildersByWs[wsCfg.ID] = active
			}
		}
	}

	_, err = dec.Token() // read closing bracket
	if err != nil {
		return fmt.Errorf("error reading closing bracket: %v", err)
	}

	data := &WorkspacesData{
		workspaces:          workspaces,
		byID:                byID,
		profileBuildersByWs: profileBuildersByWs,
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
	url := fmt.Sprintf("%s/workspaces-with-profiles", baseURL)
	return appbase.NewHTTPRepository[WorkspacesData]("workspaces-with-profiles", url, token, appbase.HTTPTagLastModified, &WorkspacesRepositoryData{}, 1, refreshPeriodSec, cacheDir)
}

// Helper functions for aggregating workspace data
func CalculateWorkspaceData(
	ws *WorkspaceConfig,
	connections []*EnrichedConnectionConfig,
	functions []*FunctionConfig,
	profileBuilders []*ProfileBuilderConfig,
) *WorkspaceData {
	maxUpdatedAt := ws.UpdatedAt
	filteredFunctions := make([]*FunctionConfig, 0, len(functions))
	for _, fn := range functions {
		if fn.UpdatedAt.After(maxUpdatedAt) {
			maxUpdatedAt = fn.UpdatedAt
		}
		if fn.Kind == "profile" {
			// Skip profile functions — they are handled via profileBuilders
			continue
		}
		filteredFunctions = append(filteredFunctions, fn)
	}
	filteredConnections := make([]*EnrichedConnectionConfig, 0, len(connections))
	for _, conn := range connections {
		filteredConnections = append(filteredConnections, conn)
		if conn.UpdatedAt != nil && conn.UpdatedAt.After(maxUpdatedAt) {
			maxUpdatedAt = *conn.UpdatedAt
		}
	}
	for _, pb := range profileBuilders {
		if pb.UpdatedAt.After(maxUpdatedAt) {
			maxUpdatedAt = pb.UpdatedAt
		}
	}

	// Calculate config hash for change detection
	configHash := CalculateConfigHash(filteredConnections, filteredFunctions, profileBuilders, []string{ws.ID})

	return &WorkspaceData{
		WorkspaceID:     ws.ID,
		MaxUpdatedAt:    maxUpdatedAt,
		Connections:     filteredConnections,
		Functions:       filteredFunctions,
		ProfileBuilders: profileBuilders,
		ConfigHash:      configHash,
	}
}

func CalculateConfigHash(connections []*EnrichedConnectionConfig, functions []*FunctionConfig, profileBuilders []*ProfileBuilderConfig, workspaceIDs []string) string {
	h := sha256.New()

	// Sort and hash workspace IDs
	sortedWsIDs := make([]string, len(workspaceIDs))
	copy(sortedWsIDs, workspaceIDs)
	slices.Sort(sortedWsIDs)
	for _, wsID := range sortedWsIDs {
		h.Write([]byte(wsID))
	}

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
	}

	// Sort and hash profile builders
	pbIDs := make([]string, 0, len(profileBuilders))
	pbMap := make(map[string]*ProfileBuilderConfig, len(profileBuilders))
	for _, pb := range profileBuilders {
		pbIDs = append(pbIDs, pb.ID)
		pbMap[pb.ID] = pb
	}
	slices.Sort(pbIDs)
	for _, id := range pbIDs {
		pb := pbMap[id]
		h.Write([]byte(id))
		h.Write([]byte(pb.UpdatedAt.Format(time.RFC3339)))
		// Sort profile builder functions by ID for deterministic hashing
		pbFnIDs := make([]string, 0, len(pb.Functions))
		pbFnMap := make(map[string]*FunctionConfig, len(pb.Functions))
		for _, fn := range pb.Functions {
			pbFnIDs = append(pbFnIDs, fn.ID)
			pbFnMap[fn.ID] = fn
		}
		slices.Sort(pbFnIDs)
		for _, fnID := range pbFnIDs {
			fn := pbFnMap[fnID]
			h.Write([]byte(fn.ID))
			h.Write([]byte(fn.CodeHash))
		}
	}

	return hex.EncodeToString(h.Sum(nil))[:16]
}
