package main

import (
	"encoding/json"
	"fmt"
	"io"
	"sync/atomic"
	"time"

	"github.com/jitsucom/bulker/jitsubase/appbase"
)

// SyncEntry mirrors one element of the JSON array returned by the console
// endpoint /api/admin/export/syncs. The schema is owned by webapps/console;
// keep it in sync with that source of truth.
//
// Two intentionally generic JSON blobs:
//   - Source.Config and Destination.Config are the raw service / destination
//     configurations including credentials. We hand them off to the sync Pod
//     unchanged via a per-CronJob Secret.
//   - Options is the (sync.data ∖ {schedule, timezone}) ∪ {versionHash} blob.
//     The sync-sidecar load-catalog-state subcommand uses options.streams,
//     options.disabledStreams, and options.schemaChanges to apply the
//     selectStreamsFromCatalog port.
type SyncEntry struct {
	ID            string           `json:"id"`
	WorkspaceID   string           `json:"workspaceId"`
	WorkspaceSlug string           `json:"workspaceSlug"`
	FromID        string           `json:"fromId"`
	ToID          string           `json:"toId"`
	Source        SyncSourceConfig `json:"source"`
	Destination   json.RawMessage  `json:"destination"`
	Schedule      string           `json:"schedule,omitempty"` // empty → manual-only sync, no CronJob
	Timezone      string           `json:"timezone"`
	Options       json.RawMessage  `json:"options"`
	UpdatedAt     time.Time        `json:"updatedAt"`
}

type SyncSourceConfig struct {
	Package     string          `json:"package"`
	Version     string          `json:"version"`
	Authorized  bool            `json:"authorized"`
	Credentials json.RawMessage `json:"credentials"`
}

// SyncsData is the in-memory representation of the polled syncs export.
// Indexed by sync ID for O(1) lookup during reconcile + manual-trigger paths.
type SyncsData struct {
	Syncs        []*SyncEntry
	BySyncID     map[string]*SyncEntry
	LastModified time.Time
}

type SyncsRepositoryData struct {
	data atomic.Pointer[SyncsData]
}

// Init parses the JSON array streamed by the export endpoint.
func (s *SyncsRepositoryData) Init(reader io.Reader, tag any) error {
	dec := json.NewDecoder(reader)
	if _, err := dec.Token(); err != nil {
		return fmt.Errorf("error reading open bracket: %w", err)
	}

	syncs := make([]*SyncEntry, 0)
	bySyncID := make(map[string]*SyncEntry)

	for dec.More() {
		entry := &SyncEntry{}
		if err := dec.Decode(entry); err != nil {
			return fmt.Errorf("error decoding sync entry: %w", err)
		}
		if entry.Timezone == "" {
			entry.Timezone = "Etc/UTC"
		}
		syncs = append(syncs, entry)
		bySyncID[entry.ID] = entry
	}

	if _, err := dec.Token(); err != nil {
		return fmt.Errorf("error reading close bracket: %w", err)
	}

	data := &SyncsData{
		Syncs:    syncs,
		BySyncID: bySyncID,
	}
	if tag != nil {
		if t, ok := tag.(time.Time); ok {
			data.LastModified = t
		}
	}
	s.data.Store(data)
	return nil
}

func (s *SyncsRepositoryData) GetData() *SyncsData {
	return s.data.Load()
}

func (s *SyncsRepositoryData) Store(writer io.Writer) error {
	d := s.data.Load()
	if d == nil {
		return nil
	}
	return json.NewEncoder(writer).Encode(d.Syncs)
}

// NewSyncsRepository wires the syncs export polling repository.
func NewSyncsRepository(baseURL, token string, refreshPeriodSec int, cacheDir string) appbase.Repository[SyncsData] {
	url := fmt.Sprintf("%s/syncs", baseURL)
	return appbase.NewHTTPRepository[SyncsData]("syncs", url, token, appbase.HTTPTagLastModified, &SyncsRepositoryData{}, 1, refreshPeriodSec, cacheDir)
}
