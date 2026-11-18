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

// sourceTaskDDL mirrors source_task from webapps/console/prisma/schema.prisma (primary key source_task_pkey). A commit at
// a checkpoint refreshes the running task through updateRunningStatus, so tests that commit at a checkpoint need it.
const sourceTaskDDL = `create table source_task (
  sync_id text not null, task_id text not null, package text not null, version text not null,
  started_at timestamptz(3) not null default now(), updated_at timestamptz(3) not null default now(),
  started_by jsonb, status text not null, description text, metrics jsonb, error text,
  constraint source_task_pkey primary key (task_id))`

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

// countingStream is a destination stream that counts how often it was committed. err, if set, is what the commit returns.
type countingStream struct {
	rejectingStream
	commits int
}

func (c *countingStream) Complete(context.Context) (bulker.State, error) {
	c.commits++
	return bulker.State{}, c.err
}

// A GLOBAL or LEGACY checkpoint covers every stream, and a source can interleave the records of several streams before
// it. Committing only the last stream that was opened leaves the others buffered, and the held checkpoint then never
// advances even though the destination is healthy (JITSU-258 review, third finding). Every stream that is due for a
// commit at a checkpoint has to be committed, not just the last one.
func TestSharedCheckpointCommitsEveryEligibleStream(t *testing.T) {
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

	if _, err := pool.Exec(ctx, sourceTaskDDL); err != nil {
		t.Fatalf("could not create source_task: %v", err)
	}

	// the last stream listed is the last one opened (lastStream), as in a source that interleaves streams
	newSidecar := func(syncID string, streams ...*ActiveStream) *ReadSideCar {
		s := &ReadSideCar{
			AbstractSideCar:  &AbstractSideCar{logLevel: "FATAL", dbLogLevel: "FATAL", syncId: syncID, taskId: "task-" + syncID, packageName: "airbyte/source-test", packageVersion: "1", startedAt: time.Now(), dbpool: pool, eventsLogService: noopEventsLog{}},
			processedStreams: map[string]*ActiveStream{},
			catalog:          jsonorder.NewOrderedMap[string, *Stream](0),
		}
		for _, st := range streams {
			s.processedStreams[st.name] = st
			s.lastStream = st
		}
		return s
	}
	buffered := func(name, syncMode string, dest bulker.BulkerStream) *ActiveStream {
		st := NewActiveStream(name, syncMode, bulker.Batch)
		if err := st.Begin(dest); err != nil {
			t.Fatal(err)
		}
		st.bufferedEventsCount = 5
		return st
	}
	global := func() *StateRow {
		return &StateRow{Type: "GLOBAL", GlobalState: &GlobalState{SharedState: map[string]any{"cursor": "c1"}}}
	}
	legacy := func() *StateRow {
		data := jsonorder.NewOrderedMap[string, any](1)
		data.Set("cursor", "l1")
		return &StateRow{Type: "LEGACY", Data: data}
	}
	rows := func(syncID string) int {
		var n int
		if err := pool.QueryRow(ctx, "select count(*) from source_state where sync_id = $1 and stream in ('_GLOBAL_STATE', '_LEGACY_STATE')", syncID).Scan(&n); err != nil {
			t.Fatalf("could not read source_state: %v", err)
		}
		return n
	}

	t.Run("interleaved incremental streams: all are committed and the checkpoint is saved at once", func(t *testing.T) {
		a, b := &countingStream{}, &countingStream{}
		s := newSidecar("both", buffered("a", "incremental", a), buffered("b", "incremental", b))
		s.processState(global())
		if a.commits != 1 || b.commits != 1 {
			t.Fatalf("commits: a=%d b=%d, want 1 and 1: the checkpoint covers both streams", a.commits, b.commits)
		}
		if n := rows("both"); n != 1 {
			t.Fatalf("%d checkpoint row(s) saved after every stream committed, want 1", n)
		}
	})

	t.Run("legacy checkpoint commits every eligible stream too", func(t *testing.T) {
		a, b := &countingStream{}, &countingStream{}
		s := newSidecar("legacy", buffered("a", "incremental", a), buffered("b", "incremental", b))
		s.processState(legacy())
		if a.commits != 1 || b.commits != 1 {
			t.Fatalf("commits: a=%d b=%d, want 1 and 1", a.commits, b.commits)
		}
		if n := rows("legacy"); n != 1 {
			t.Fatalf("%d checkpoint row(s) saved, want 1", n)
		}
	})

	t.Run("one stream fails to commit: nothing is saved", func(t *testing.T) {
		a, b := &countingStream{rejectingStream: rejectingStream{err: errAddressNotAllowed}}, &countingStream{}
		s := newSidecar("failing", buffered("a", "incremental", a), buffered("b", "incremental", b))
		s.processState(global())
		if a.commits != 1 || b.commits != 1 {
			t.Fatalf("commits: a=%d b=%d, want 1 and 1 (both are attempted)", a.commits, b.commits)
		}
		if n := rows("failing"); n != 0 {
			t.Fatalf("%d checkpoint row(s) saved although stream a failed to commit", n)
		}
	})

	// A stream that is not incremental is only committed when it closes (it replaces its table), so the checkpoint has to
	// wait for it. Control for the rule above: eligible streams commit, the others keep the checkpoint held.
	t.Run("a stream that is not incremental keeps the checkpoint held until it closes", func(t *testing.T) {
		a, b := &countingStream{}, &countingStream{}
		s := newSidecar("mixed", buffered("a", "full_refresh", a), buffered("b", "incremental", b))
		s.processState(global())
		if a.commits != 0 || b.commits != 1 {
			t.Fatalf("commits: a=%d b=%d, want 0 and 1: only the incremental stream is due", a.commits, b.commits)
		}
		if n := rows("mixed"); n != 0 {
			t.Fatalf("%d checkpoint row(s) saved while stream a is still buffering, want 0", n)
		}
		s.closeActiveStreams(true)
		if a.commits != 1 {
			t.Fatalf("stream a commits after the close: %d, want 1", a.commits)
		}
		if n := rows("mixed"); n != 1 {
			t.Fatalf("%d checkpoint row(s) after stream a committed, want 1", n)
		}
	})
}
