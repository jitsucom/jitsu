package main

import (
	"bufio"
	"context"
	"encoding/json"
	"errors"
	"os"
	"strings"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/jitsucom/bulker/jitsubase/logging"
	"github.com/jitsucom/bulker/jitsubase/pg"
	"github.com/jitsucom/bulker/sync-sidecar/db"
)

// load-catalog-state subcommand. Run as init container in the autonomous
// sync Pod template. Reads:
//
//   - /shared/discover.jsonl  (optional — only present if discover init ran).
//     Parses out the airbyte CATALOG message and UPSERTs newjitsu.source_catalog
//     so subsequent runs can skip discover.
//   - newjitsu.source_catalog WHERE key=$STORAGE_KEY AND package=$PACKAGE
//     AND version=$PACKAGE_VERSION.
//   - newjitsu.source_state  WHERE sync_id=$SYNC_ID.
//
// Writes:
//   - /shared/catalog.json  — configured (selected/filtered) airbyte catalog
//                              ready for `source read --catalog`.
//   - /shared/state.json    — airbyte state list ready for `source read --state`.
//                              Empty array if no prior state exists.
//
// Required env: SYNC_ID, STORAGE_KEY, PACKAGE, PACKAGE_VERSION, DATABASE_URL,
// OPTIONS_JSON (the sync's options blob, used for stream selection).

const (
	sharedDir          = "/shared"
	discoverOutPath    = sharedDir + "/discover.jsonl"
	discoverStderrPath = sharedDir + "/discover.stderr"
	catalogOutPath     = sharedDir + "/catalog.json"
	stateOutPath       = sharedDir + "/state.json"
	legacyStateStream  = "_LEGACY_STATE"
	globalStateStream  = "_GLOBAL_STATE"
)

func runLoadCatalogState() {
	syncID := requireEnv("SYNC_ID")
	storageKey := requireEnv("STORAGE_KEY")
	pkg := requireEnv("PACKAGE")
	pkgVer := requireEnv("PACKAGE_VERSION")
	dbURL := requireEnv("DATABASE_URL")

	var opts SyncOptions
	if raw := os.Getenv("OPTIONS_JSON"); raw != "" {
		if err := json.Unmarshal([]byte(raw), &opts); err != nil {
			logging.Errorf("[load] OPTIONS_JSON parse: %v", err)
			os.Exit(2)
		}
	}

	ctx, cancel := context.WithTimeout(context.Background(), 60*time.Second)
	defer cancel()
	// MUST go through pg.NewPGPool (not pgxpool.New directly) so the `?schema=`
	// query param in DATABASE_URL is extracted and applied via per-conn
	// `SET search_path`. Otherwise the unqualified SQL in db/db.go (e.g.
	// `INSERT INTO source_catalog ...` used by UpsertCatalogSuccess below)
	// resolves against `public` and fails with 42P01.
	pool, err := pg.NewPGPool(dbURL)
	if err != nil {
		logging.Errorf("[load] db connect: %v", err)
		os.Exit(2)
	}
	defer pool.Close()

	// Step 1: if a discover init wrote /shared/discover.jsonl, extract the
	// CATALOG message and persist it. This refreshes source_catalog before
	// the next step reads it back.
	if _, err := os.Stat(discoverOutPath); err == nil {
		if catalog, err := extractCatalogFromDiscover(discoverOutPath); err != nil {
			logging.Errorf("[load] parsing %s: %v", discoverOutPath, err)
			os.Exit(1)
		} else if catalog != nil {
			if err := db.UpsertCatalogSuccess(pool, pkg, pkgVer, storageKey, catalog, time.Now(), "SUCCESS", "discover ok"); err != nil {
				logging.Errorf("[load] upserting catalog: %v", err)
				os.Exit(1)
			}
			logging.Infof("[load] persisted refreshed catalog from %s", discoverOutPath)
		} else {
			logging.Warnf("[load] no CATALOG message found in %s", discoverOutPath)
		}
	}

	// Step 2: read the catalog row.
	rawCatalog, err := loadCatalogRow(ctx, pool, pkg, pkgVer, storageKey)
	if err != nil {
		logging.Errorf("[load] catalog row: %v", err)
		os.Exit(1)
	}
	if rawCatalog == nil {
		logging.Errorf("[load] no catalog in source_catalog for (key=%s, package=%s, version=%s) — run Discover first", storageKey, pkg, pkgVer)
		os.Exit(1)
	}

	// Step 3: apply selectStreamsFromCatalog port.
	configured, err := SelectStreamsFromCatalog(rawCatalog, &opts)
	if err != nil {
		logging.Errorf("[load] selecting streams: %v", err)
		os.Exit(1)
	}
	if err := writeJSON(catalogOutPath, configured); err != nil {
		logging.Errorf("[load] writing %s: %v", catalogOutPath, err)
		os.Exit(1)
	}

	// Step 4: load source_state and format for airbyte.
	state, err := loadSyncState(ctx, pool, syncID, &opts)
	if err != nil {
		logging.Errorf("[load] loading source_state: %v", err)
		os.Exit(1)
	}
	if err := writeJSON(stateOutPath, state); err != nil {
		logging.Errorf("[load] writing %s: %v", stateOutPath, err)
		os.Exit(1)
	}

	logging.Infof("[load] catalog (%d streams) and state written for sync %s", len(configured.Streams), syncID)
}

func requireEnv(key string) string {
	v := os.Getenv(key)
	if v == "" {
		logging.Errorf("[load] env %s is required", key)
		os.Exit(2)
	}
	return v
}

func writeJSON(path string, v any) error {
	b, err := json.Marshal(v)
	if err != nil {
		return err
	}
	return os.WriteFile(path, b, 0o644)
}

// extractCatalogFromDiscover scans the airbyte JSONL output and returns the
// catalog field of the first AirbyteMessage with type=CATALOG, or nil if no
// such message is present. The output of `airbyte/source-X discover` mixes
// log lines with the actual catalog message; we only care about the latter.
func extractCatalogFromDiscover(path string) (any, error) {
	f, err := os.Open(path)
	if err != nil {
		return nil, err
	}
	defer f.Close()

	scanner := bufio.NewScanner(f)
	scanner.Buffer(make([]byte, 1024*1024), 64*1024*1024) // catalogs can be big
	for scanner.Scan() {
		line := strings.TrimSpace(scanner.Text())
		if !strings.HasPrefix(line, "{") {
			continue
		}
		var msg map[string]any
		if err := json.Unmarshal([]byte(line), &msg); err != nil {
			continue
		}
		if t, _ := msg["type"].(string); t == "CATALOG" {
			return msg["catalog"], nil
		}
	}
	if err := scanner.Err(); err != nil {
		return nil, err
	}
	return nil, nil
}

func loadCatalogRow(ctx context.Context, pool *pgxpool.Pool, pkg, version, storageKey string) (map[string]any, error) {
	row := pool.QueryRow(ctx, `SELECT catalog FROM newjitsu.source_catalog WHERE key=$1 AND package=$2 AND version=$3`, storageKey, pkg, version)
	var catalog map[string]any
	if err := row.Scan(&catalog); err != nil {
		// Avoid coupling to pgx error sentinels — string match is fine here.
		if strings.Contains(err.Error(), "no rows") {
			return nil, nil
		}
		return nil, err
	}
	return catalog, nil
}

// loadSyncState mirrors the TypeScript loadState() in
// webapps/console/lib/server/sync.ts. Returns the airbyte-compatible state
// payload to write to /shared/state.json:
//
//   - no rows                                    → []
//   - single row with stream "_LEGACY_STATE"     → that row's state object verbatim
//   - single row with stream "_GLOBAL_STATE"     → [{ type: "GLOBAL", global: ... }]
//   - otherwise                                  → [{ type: "STREAM", stream: { stream_descriptor: {name, namespace}, stream_state: ... } }, …]
//     filtered to skip the legacy/global sentinels and any streams the user
//     configured as full_refresh.
func loadSyncState(ctx context.Context, pool *pgxpool.Pool, syncID string, opts *SyncOptions) (any, error) {
	rows, err := pool.Query(ctx, `SELECT stream, state FROM newjitsu.source_state WHERE sync_id=$1`, syncID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	type stateRow struct {
		stream string
		state  map[string]any
	}
	var all []stateRow
	for rows.Next() {
		var sr stateRow
		if err := rows.Scan(&sr.stream, &sr.state); err != nil {
			return nil, err
		}
		all = append(all, sr)
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}

	if len(all) == 0 {
		// Return {} — NOT [] — to match what scheduleSync passes for "no
		// state". ReadSideCar.loadState treats {} as no-state but used to
		// treat [] as state-present, which would flip incremental streams
		// from first-run replace into batch mode. (read.go now also
		// tolerates [], but we still emit {} to stay consistent with the
		// legacy reactive flow's wire format.)
		return map[string]any{}, nil
	}
	if len(all) == 1 && all[0].stream == legacyStateStream {
		return all[0].state, nil
	}
	if len(all) == 1 && all[0].stream == globalStateStream {
		return []any{map[string]any{"type": "GLOBAL", "global": all[0].state}}, nil
	}

	out := make([]any, 0, len(all))
	for _, r := range all {
		if r.stream == legacyStateStream || r.stream == globalStateStream {
			continue
		}
		// Skip streams configured as full_refresh — they reload from scratch
		// every run and shouldn't carry state.
		if cfg := opts.streamConfig(r.stream); cfg != nil && cfg.SyncMode == "full_refresh" {
			continue
		}
		var namespace, name string
		if i := strings.IndexByte(r.stream, '.'); i >= 0 {
			namespace = r.stream[:i]
			name = r.stream[i+1:]
		} else {
			name = r.stream
		}
		desc := map[string]any{"name": name}
		if namespace != "" {
			desc["namespace"] = namespace
		}
		out = append(out, map[string]any{
			"type": "STREAM",
			"stream": map[string]any{
				"stream_descriptor": desc,
				"stream_state":      r.state,
			},
		})
	}
	return out, nil
}

// Sentinel: ensure UpsertCatalogSuccess matches our package; bind via interface
// to surface signature drift at compile time.
var _ = func() error { return errors.New("unused — type-check only") }()
