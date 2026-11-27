package main

import (
	"context"
	"errors"
	"testing"
	"time"

	bulker "github.com/jitsucom/bulker/bulkerlib"
	"github.com/jitsucom/bulker/jitsubase/jsonorder"
	"github.com/jitsucom/bulker/jitsubase/pg"
)

// A stream whose upload to the destination failed must not let a GLOBAL or LEGACY checkpoint through to the control
// plane: that cursor covers every stream, and saving it moves the sync past records that were never delivered
// (JITSU-258 review). This runs processState against a real Postgres and reads the state table back, because the harm
// is the row that gets written, not the decision that precedes it. Skips without docker or with -short.
//
// The table mirrors source_state from webapps/console/prisma/schema.prisma (primary key source_state_pkey).
const sourceStateDDL = `create table source_state (
  sync_id text not null, stream text not null, state jsonb not null,
  timestamp timestamptz(3) not null default now(),
  constraint source_state_pkey primary key (sync_id, stream))`

func TestFailedStreamDoesNotAdvanceGlobalOrLegacyCheckpoint(t *testing.T) {
	if testing.Short() {
		t.Skip("starts a real postgres")
	}
	if !dockerAvailable() {
		t.Skip("docker not available")
	}
	dsn, _ := startPostgres(t)
	pool, err := pg.NewPGPool(dsn, pg.WithStatementTimeout(10*time.Second))
	if err != nil {
		t.Fatalf("could not build pool: %v", err)
	}
	defer pool.Close()
	ctx := context.Background()
	if _, err := pool.Exec(ctx, sourceStateDDL); err != nil {
		t.Fatalf("could not create source_state: %v", err)
	}

	newSidecar := func(syncID string, stream *ActiveStream) *ReadSideCar {
		return &ReadSideCar{
			// FATAL keeps the sidecar from writing its own log lines into the (absent) task_log table.
			AbstractSideCar:  &AbstractSideCar{logLevel: "FATAL", dbLogLevel: "FATAL", syncId: syncID, dbpool: pool},
			processedStreams: map[string]*ActiveStream{stream.name: stream},
			lastStream:       stream,
		}
	}
	// the checkpoint messages a connector emits after the stream's records
	global := func() *StateRow {
		return &StateRow{Type: "GLOBAL", GlobalState: &GlobalState{SharedState: map[string]any{"cursor": "after-the-records"}}}
	}
	legacy := func() *StateRow {
		data := jsonorder.NewOrderedMap[string, any](1)
		data.Set("cursor", "after-the-records")
		return &StateRow{Type: "LEGACY", Data: data}
	}
	savedRows := func(syncID string) int {
		var n int
		if err := pool.QueryRow(ctx, "select count(*) from source_state where sync_id = $1 and stream in ('_GLOBAL_STATE', '_LEGACY_STATE')", syncID).Scan(&n); err != nil {
			t.Fatalf("could not read source_state: %v", err)
		}
		return n
	}

	t.Run("failed stream: nothing is written", func(t *testing.T) {
		failed := NewActiveStream("orders", "incremental", bulker.Batch)
		failed.RegisterError(errors.New("connection to a non-public address is not allowed"))
		s := newSidecar("sync-failed", failed)
		s.processState(global())
		s.processState(legacy())
		if n := savedRows("sync-failed"); n != 0 {
			t.Fatalf("%d checkpoint row(s) were saved for a stream whose upload failed; the next run would skip its records", n)
		}
	})

	// Control: the same calls with a healthy stream must write both rows. Without this, "no rows" above could just mean
	// the test is wired wrong.
	t.Run("healthy stream: both checkpoints are written", func(t *testing.T) {
		healthy := NewActiveStream("orders", "incremental", bulker.Batch)
		s := newSidecar("sync-healthy", healthy)
		s.processState(global())
		s.processState(legacy())
		if n := savedRows("sync-healthy"); n != 2 {
			t.Fatalf("%d checkpoint row(s) saved for a healthy stream, want 2 (_GLOBAL_STATE and _LEGACY_STATE)", n)
		}
	})
}
