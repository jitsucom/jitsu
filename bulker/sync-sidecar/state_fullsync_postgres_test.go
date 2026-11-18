package main

import (
	"context"
	"errors"
	"testing"
	"time"

	bulker "github.com/jitsucom/bulker/bulkerlib"
	"github.com/jitsucom/bulker/eventslog"
	"github.com/jitsucom/bulker/jitsubase/jsonorder"
	"github.com/jitsucom/bulker/jitsubase/pg"
)

// errAddressNotAllowed is what the guarded webhook writer returns for a local address.
var errAddressNotAllowed = errors.New("connection to a non-public address is not allowed")

// noopEventsLog is an events log that accepts everything. _closeStream posts the batch result to it.
type noopEventsLog struct{ eventslog.EventsLogService }

func (noopEventsLog) PostEvent(*eventslog.ActorEvent) (eventslog.EventsLogRecordId, error) {
	return "", nil
}

// acceptingStream is a destination stream whose commit succeeds.
type acceptingStream struct{ rejectingStream }

// A full re-sync defers every upload to the end of the stream (the replace-table commit, or 500,000 buffered records).
// A GLOBAL or LEGACY checkpoint that arrives before that covers records that are still only in memory. Saving it at
// once moves the cursor past them: if the upload then fails at the close, the next scheduled run resumes past records
// that were never delivered (JITSU-258 review, second finding). Per-stream state already waits in unsavedState until
// the stream succeeds; the shared checkpoint has to wait for the same thing.
//
// Runs the real processState and closeActiveStreams against a real Postgres and reads source_state back. Skips without
// docker or with -short.
func TestFullSyncDefersSharedCheckpointUntilTheUploadCommits(t *testing.T) {
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

	newSidecar := func(syncID string, streams ...*ActiveStream) *ReadSideCar {
		s := &ReadSideCar{
			AbstractSideCar:  &AbstractSideCar{logLevel: "FATAL", dbLogLevel: "FATAL", syncId: syncID, dbpool: pool, eventsLogService: noopEventsLog{}},
			processedStreams: map[string]*ActiveStream{},
			fullSync:         true,
		}
		for _, st := range streams {
			s.processedStreams[st.name] = st
			s.lastStream = st
		}
		return s
	}
	// a stream that has buffered records and has not uploaded them yet, as in a full re-sync
	buffered := func(name string, dest bulker.BulkerStream) *ActiveStream {
		st := NewActiveStream(name, "incremental", bulker.ReplaceTable)
		if err := st.Begin(dest); err != nil {
			t.Fatal(err)
		}
		st.bufferedEventsCount = 5
		return st
	}
	// a stream that already uploaded everything
	committed := func(name string) *ActiveStream {
		return NewActiveStream(name, "incremental", bulker.Batch)
	}
	global := func(cursor string) *StateRow {
		return &StateRow{Type: "GLOBAL", GlobalState: &GlobalState{SharedState: map[string]any{"cursor": cursor}}}
	}
	legacy := func(cursor string) *StateRow {
		data := jsonorder.NewOrderedMap[string, any](1)
		data.Set("cursor", cursor)
		return &StateRow{Type: "LEGACY", Data: data}
	}
	rows := func(syncID, stream string) int {
		var n int
		if err := pool.QueryRow(ctx, "select count(*) from source_state where sync_id = $1 and stream = $2", syncID, stream).Scan(&n); err != nil {
			t.Fatalf("could not read source_state: %v", err)
		}
		return n
	}
	cursor := func(syncID, stream string) string {
		var c string
		if err := pool.QueryRow(ctx, "select coalesce(max(coalesce(state->'shared_state'->>'cursor', state->>'cursor')), '') from source_state where sync_id = $1 and stream = $2", syncID, stream).Scan(&c); err != nil {
			t.Fatalf("could not read source_state: %v", err)
		}
		return c
	}

	t.Run("upload succeeds at close: nothing before, the latest cursor after", func(t *testing.T) {
		s := newSidecar("ok", buffered("orders", &acceptingStream{}))
		s.processState(global("c1"))
		s.processState(global("c2"))
		if n := rows("ok", "_GLOBAL_STATE"); n != 0 {
			t.Fatalf("%d GLOBAL checkpoint row(s) saved while the records are still buffered, want 0", n)
		}
		s.closeActiveStreams(true)
		if n, c := rows("ok", "_GLOBAL_STATE"), cursor("ok", "_GLOBAL_STATE"); n != 1 || c != "c2" {
			t.Fatalf("after the commit: %d row(s), cursor %q, want 1 row with the latest cursor c2", n, c)
		}
	})

	// The reviewer's scenario: the upload fails when the stream is closed.
	t.Run("upload fails at close: the checkpoint is never saved", func(t *testing.T) {
		s := newSidecar("fail", buffered("orders", &rejectingStream{err: errAddressNotAllowed}))
		s.processState(global("c1"))
		if n := rows("fail", "_GLOBAL_STATE"); n != 0 {
			t.Fatalf("%d GLOBAL checkpoint row(s) saved before the upload was attempted; if it fails the next run skips its records", n)
		}
		s.closeActiveStreams(true)
		if n := rows("fail", "_GLOBAL_STATE"); n != 0 {
			t.Fatalf("%d GLOBAL checkpoint row(s) saved after the upload failed", n)
		}
	})

	t.Run("legacy checkpoint waits as well", func(t *testing.T) {
		okSync, failSync := "legacy-ok", "legacy-fail"
		s := newSidecar(okSync, buffered("orders", &acceptingStream{}))
		s.processState(legacy("l1"))
		if n := rows(okSync, "_LEGACY_STATE"); n != 0 {
			t.Fatalf("%d LEGACY row(s) saved while the records are still buffered, want 0", n)
		}
		s.closeActiveStreams(true)
		if n, c := rows(okSync, "_LEGACY_STATE"), cursor(okSync, "_LEGACY_STATE"); n != 1 || c != "l1" {
			t.Fatalf("after the commit: %d row(s), cursor %q, want 1 row with l1", n, c)
		}
		f := newSidecar(failSync, buffered("orders", &rejectingStream{err: errAddressNotAllowed}))
		f.processState(legacy("l1"))
		f.closeActiveStreams(true)
		if n := rows(failSync, "_LEGACY_STATE"); n != 0 {
			t.Fatalf("%d LEGACY row(s) saved after the upload failed", n)
		}
	})

	t.Run("run interrupted before the close: nothing is saved", func(t *testing.T) {
		s := newSidecar("aborted", buffered("orders", &acceptingStream{}))
		s.processState(global("c1"))
		s.closeActiveStreams(false) // what the sidecar does on cancel or a critical error: abort, do not commit
		if n := rows("aborted", "_GLOBAL_STATE"); n != 0 {
			t.Fatalf("%d GLOBAL row(s) saved for a run that never committed its records", n)
		}
	})

	t.Run("another stream still buffering holds the checkpoint", func(t *testing.T) {
		s := newSidecar("two", committed("a"), buffered("b", &acceptingStream{}))
		s.processState(global("c1"))
		if n := rows("two", "_GLOBAL_STATE"); n != 0 {
			t.Fatalf("%d row(s) saved while stream b still has buffered records, want 0", n)
		}
		s.closeActiveStreams(true)
		if n := rows("two", "_GLOBAL_STATE"); n != 1 {
			t.Fatalf("%d row(s) after stream b committed, want 1", n)
		}
	})

	// Control: when nothing is waiting to be uploaded the checkpoint is saved at once, as before.
	t.Run("nothing buffered: saved at once", func(t *testing.T) {
		s := newSidecar("now", committed("orders"))
		s.processState(global("c1"))
		s.processState(legacy("l1"))
		if g, l := rows("now", "_GLOBAL_STATE"), rows("now", "_LEGACY_STATE"); g != 1 || l != 1 {
			t.Fatalf("GLOBAL rows %d, LEGACY rows %d, want 1 and 1 saved at once", g, l)
		}
	})
}
