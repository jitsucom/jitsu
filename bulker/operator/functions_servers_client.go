package main

import (
	"context"
	"encoding/json"
	"fmt"
	"strings"
	"sync"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

// FunctionsServerRecord represents a record in the FunctionsServer table
type FunctionsServerRecord struct {
	WorkspaceID      string
	Class            string
	DeploymentID     string
	Connections      []string
	EmptyConnections []string
}

// FunctionsServerDB handles direct PostgreSQL operations for the FunctionsServer table
type FunctionsServerDB struct {
	dbpool     *pgxpool.Pool
	mu         sync.Mutex
	lastSynced map[string]string // deploymentID -> configHash at last sync
}

// NewFunctionsServerDB creates a new FunctionsServer database client
func NewFunctionsServerDB(dbpool *pgxpool.Pool) *FunctionsServerDB {
	return &FunctionsServerDB{
		dbpool:     dbpool,
		lastSynced: make(map[string]string),
	}
}

// IsDeploymentChanged returns true if the deployment needs to be synced
func (db *FunctionsServerDB) IsDeploymentChanged(deploymentID string, configHash string) bool {
	db.mu.Lock()
	defer db.mu.Unlock()
	return db.lastSynced[deploymentID] != configHash
}

// MarkDeploymentSynced records the config hash for a deployment after successful sync
func (db *FunctionsServerDB) MarkDeploymentSynced(deploymentID string, configHash string) {
	db.mu.Lock()
	defer db.mu.Unlock()
	db.lastSynced[deploymentID] = configHash
}

// ReplaceRecordsForDeployment atomically replaces all FunctionsServer records for a deployment.
// In a transaction: deletes all existing records for the deploymentId, then batch-inserts new ones.
// createdAt is the deployment's creation timestamp, updatedAt is the rollout completion time.
func (db *FunctionsServerDB) ReplaceRecordsForDeployment(deploymentID string, records []FunctionsServerRecord, createdAt time.Time, updatedAt time.Time) error {
	ctx := context.Background()
	tx, err := db.dbpool.Begin(ctx)
	if err != nil {
		return fmt.Errorf("failed to begin transaction: %v", err)
	}
	defer tx.Rollback(ctx)

	// Delete all existing records for this deployment
	_, err = tx.Exec(ctx,
		`DELETE FROM newjitsu."FunctionsServer" WHERE "deploymentId" = $1`,
		deploymentID,
	)
	if err != nil {
		return fmt.Errorf("failed to delete records for deployment %s: %v", deploymentID, err)
	}

	// Batch-insert new records
	if len(records) > 0 {
		batch := &pgx.Batch{}
		for _, r := range records {
			batch.Queue(
				`INSERT INTO newjitsu."FunctionsServer" ("workspaceId", "class", "deploymentId", "connections", "emptyConnections", "createdAt", "updatedAt")
				 VALUES ($1, $2, $3, $4, $5, $6, $7)
				 ON CONFLICT ("workspaceId", "class") DO UPDATE SET
				     "deploymentId" = EXCLUDED."deploymentId",
				     "connections" = EXCLUDED."connections",
				     "emptyConnections" = EXCLUDED."emptyConnections",
				     "updatedAt" = EXCLUDED."updatedAt"`,
				r.WorkspaceID,
				r.Class,
				r.DeploymentID,
				r.Connections,
				r.EmptyConnections,
				createdAt,
				updatedAt,
			)
		}
		br := tx.SendBatch(ctx, batch)
		for i := 0; i < len(records); i++ {
			_, err = br.Exec()
			if err != nil {
				br.Close()
				return fmt.Errorf("failed to insert FunctionsServer record %d for deployment %s: %v", i, deploymentID, err)
			}
		}
		if err := br.Close(); err != nil {
			return fmt.Errorf("failed to close batch for deployment %s: %v", deploymentID, err)
		}
	}

	if err := tx.Commit(ctx); err != nil {
		return fmt.Errorf("failed to commit transaction: %v", err)
	}
	return nil
}

// DeleteRecordsForDeployment deletes all FunctionsServer records for a deployment
func (db *FunctionsServerDB) DeleteRecordsForDeployment(deploymentID string) error {
	ctx := context.Background()
	_, err := db.dbpool.Exec(ctx,
		`DELETE FROM newjitsu."FunctionsServer" WHERE "deploymentId" = $1`,
		deploymentID,
	)
	if err != nil {
		return fmt.Errorf("failed to delete FunctionsServer records for deployment %s: %v", deploymentID, err)
	}
	db.mu.Lock()
	delete(db.lastSynced, deploymentID)
	db.mu.Unlock()
	return nil
}

// groupConnectionsByWorkspace splits connections into those with UDF functions and those without.
func groupConnectionsByWorkspace(connections []*EnrichedConnectionConfig) (withFunctions map[string][]string, withoutFunctions map[string][]string) {
	withFunctions = make(map[string][]string)
	withoutFunctions = make(map[string][]string)

	for _, conn := range connections {
		hasFunctions := false
		if opts, ok := conn.Options["functions"]; ok {
			if funcs, ok := opts.([]any); ok {
				for _, f := range funcs {
					if fm, ok := f.(map[string]any); ok {
						if fid, ok := fm["functionId"].(string); ok && strings.HasPrefix(fid, "udf.") {
							hasFunctions = true
							break
						}
					}
				}
			}
		}

		if hasFunctions {
			withFunctions[conn.WorkspaceID] = append(withFunctions[conn.WorkspaceID], conn.ID)
		} else {
			withoutFunctions[conn.WorkspaceID] = append(withoutFunctions[conn.WorkspaceID], conn.ID)
		}
	}
	return
}

// ConnectionsMapEntry holds per-workspace connection IDs for the deployment annotation
type ConnectionsMapEntry struct {
	Connections      []string `json:"c"`
	EmptyConnections []string `json:"e"`
}

// BuildConnectionsMapAnnotation computes the connections map from deployment data and serializes it as JSON.
func BuildConnectionsMapAnnotation(data *DeploymentData) string {
	connectionsByWorkspace, emptyConnectionsByWorkspace := groupConnectionsByWorkspace(data.Connections)

	m := make(map[string]ConnectionsMapEntry, len(data.WorkspaceIDs))
	for _, wsID := range data.WorkspaceIDs {
		c := connectionsByWorkspace[wsID]
		e := emptyConnectionsByWorkspace[wsID]
		if c == nil {
			c = []string{}
		}
		if e == nil {
			e = []string{}
		}
		m[wsID] = ConnectionsMapEntry{Connections: c, EmptyConnections: e}
	}
	b, _ := json.Marshal(m)
	return string(b)
}

// ParseConnectionsMapAnnotation deserializes the connections map annotation.
func ParseConnectionsMapAnnotation(annotation string) map[string]ConnectionsMapEntry {
	if annotation == "" {
		return nil
	}
	var m map[string]ConnectionsMapEntry
	if err := json.Unmarshal([]byte(annotation), &m); err != nil {
		return nil
	}
	return m
}

// BuildRecordsFromConnectionsMap builds FunctionsServer records from a parsed connections map annotation.
func BuildRecordsFromConnectionsMap(connectionsMap map[string]ConnectionsMapEntry, deploymentID string, functionsClass string) []FunctionsServerRecord {
	records := make([]FunctionsServerRecord, 0, len(connectionsMap))
	for wsID, entry := range connectionsMap {
		records = append(records, FunctionsServerRecord{
			WorkspaceID:      wsID,
			Class:            functionsClass,
			DeploymentID:     deploymentID,
			Connections:      entry.Connections,
			EmptyConnections: entry.EmptyConnections,
		})
	}
	return records
}
