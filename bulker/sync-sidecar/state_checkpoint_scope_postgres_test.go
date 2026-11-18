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

// typedBulker is a destination of a given type. Only Type() is used by the code under test.
type typedBulker struct {
	bulker.Bulker
	typeID string
}

func (b typedBulker) Type() string { return b.typeID }

// cancellingStream raises the sidecar's cancel flag while it commits, the way SIGTERM arrives during an upload.
type cancellingStream struct {
	countingStream
	onCommit func()
}

func (c *cancellingStream) Complete(ctx context.Context) (bulker.State, error) {
	if c.onCommit != nil {
		c.onCommit()
	}
	return c.countingStream.Complete(ctx)
}

// Two more properties of the shared (GLOBAL and LEGACY) checkpoint, both from the JITSU-258 review:
//
//  1. An empty replace-table stream must not be committed at a checkpoint. A warehouse replace-table commit that consumed
//     no rows replaces the table with an empty one, so committing a stream that has only been opened (STARTED) would
//     empty its table; if the job then fails before its rows arrive the table stays empty. That commit belongs to the
//     stream's own completion.
//  2. A held checkpoint waits only for the records it covers. Once those have been committed it is saved, even if another
//     stream has buffered newer rows since, and a later failure of those newer rows does not drop it.
//
// Real Postgres, real processState and _closeStream, counting fake destination streams. Skips without docker or -short.
func TestSharedCheckpointScope(t *testing.T) {
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
	for _, ddl := range []string{sourceStateDDL, sourceTaskDDL} {
		if _, err := pool.Exec(ctx, ddl); err != nil {
			t.Fatalf("could not create the control-plane tables: %v", err)
		}
	}

	// the last stream listed is the last one opened (lastStream)
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
	open := func(name, syncMode string, mode bulker.BulkMode, dest bulker.BulkerStream, buffered int) *ActiveStream {
		st := NewActiveStream(name, syncMode, mode)
		if err := st.Begin(dest); err != nil {
			t.Fatal(err)
		}
		st.bufferedEventsCount = buffered
		return st
	}
	global := func(cursor string) *StateRow {
		return &StateRow{Type: "GLOBAL", GlobalState: &GlobalState{SharedState: map[string]any{"cursor": cursor}}}
	}
	rows := func(syncID string) int {
		var n int
		if err := pool.QueryRow(ctx, "select count(*) from source_state where sync_id = $1 and stream = '_GLOBAL_STATE'", syncID).Scan(&n); err != nil {
			t.Fatalf("could not read source_state: %v", err)
		}
		return n
	}
	cursor := func(syncID string) string {
		var c string
		if err := pool.QueryRow(ctx, "select coalesce(max(state->'shared_state'->>'cursor'), '') from source_state where sync_id = $1 and stream = '_GLOBAL_STATE'", syncID).Scan(&c); err != nil {
			t.Fatalf("could not read source_state: %v", err)
		}
		return c
	}

	t.Run("an empty replace-table stream is left for its own completion", func(t *testing.T) {
		// state was cleared, so every stream runs in replace-table mode. A has only been opened (STARTED), B has rows.
		a, b := &countingStream{}, &countingStream{}
		s := newSidecar("empty", open("a", "incremental", bulker.ReplaceTable, a, 0), open("b", "incremental", bulker.ReplaceTable, b, 5))
		s.processState(global("c1"))
		if a.commits != 0 {
			t.Fatalf("stream a was committed %d time(s) at the checkpoint while it had no rows: a replace-table commit of an empty stream empties its table", a.commits)
		}
		if b.commits != 1 {
			t.Fatalf("stream b commits: %d, want 1 (it has rows and is due)", b.commits)
		}
		// A's table has not been replaced yet. The checkpoint must not be saved past it, see the next case.
		if n := rows("empty"); n != 0 {
			t.Fatalf("%d checkpoint row(s) saved while stream a's table replacement is still pending, want 0", n)
		}
		s.closeActiveStreams(true)
		if a.commits != 1 {
			t.Fatalf("stream a commits after the close: %d, want 1 (its own completion handles it)", a.commits)
		}
		if n := rows("empty"); n != 1 {
			t.Fatalf("%d checkpoint row(s) saved after stream a replaced its table, want 1", n)
		}
	})

	// Second review round: A has rows and B has only been opened (STARTED), in replace-table mode because the saved state was
	// reset. If the checkpoint were saved without B's table being replaced and the run then stopped, the retry would see a
	// saved checkpoint and open B in batch mode: it would append to B's old table and keep rows that were deleted at the
	// source. So the checkpoint has to stay unsaved until B's own completion has replaced its table.
	t.Run("a pending table replacement keeps the checkpoint unsaved, so a retry replaces it", func(t *testing.T) {
		a, b := &countingStream{}, &countingStream{}
		s := newSidecar("retry", open("a", "incremental", bulker.ReplaceTable, a, 5), open("b", "incremental", bulker.ReplaceTable, b, 0))
		s.processState(global("c1"))
		if b.commits != 0 {
			t.Fatalf("stream b was committed %d time(s) at the checkpoint while it had no rows (that would empty its table early)", b.commits)
		}
		if n := rows("retry"); n != 0 {
			t.Fatalf("%d checkpoint row(s) saved although stream b's table replacement has not happened: a retry would open b in batch mode and append to its old table", n)
		}
		// the run stops before b commits: abort, nothing is committed
		s.closeActiveStreams(false)
		if n := rows("retry"); n != 0 {
			t.Fatalf("%d checkpoint row(s) saved for a run that stopped before b's replacement", n)
		}
		if b.commits != 0 {
			t.Fatalf("stream b commits after an aborted run: %d, want 0", b.commits)
		}
	})

	t.Run("a held checkpoint is saved once the records it covers commit, whatever else is buffered", func(t *testing.T) {
		// A is a full refresh: not due at a checkpoint, so C1 is held for it. B is incremental and has committed everything
		// through C1 (nothing buffered when C1 arrives).
		a := &countingStream{}
		sa := open("a", "full_refresh", bulker.Batch, a, 5)
		sb := open("b", "incremental", bulker.Batch, &countingStream{}, 0)
		s := newSidecar("covers", sa, sb)
		s.processState(global("c1"))
		if n := rows("covers"); n != 0 {
			t.Fatalf("%d row(s) saved while stream a, which C1 covers, is still buffering, want 0", n)
		}
		// B now buffers newer rows that C1 does not cover. Its next upload will fail.
		failing := &countingStream{rejectingStream: rejectingStream{err: errAddressNotAllowed}}
		if err := sb.Begin(failing); err != nil {
			t.Fatal(err)
		}
		sb.bufferedEventsCount = 3
		// A completes: everything C1 covers is committed now.
		s._closeStream(sa, true, true)
		if a.commits != 1 {
			t.Fatalf("stream a commits: %d, want 1", a.commits)
		}
		if n, c := rows("covers"), cursor("covers"); n != 1 || c != "c1" {
			t.Fatalf("after a committed: %d row(s), cursor %q, want 1 row with c1: C1 covers only a's records, and b's newer rows are not part of it", n, c)
		}
		// B's newer rows fail to upload later. C1 was already saved and must stay.
		s.closeActiveStreams(true)
		if n, c := rows("covers"), cursor("covers"); n != 1 || c != "c1" {
			t.Fatalf("after b's upload failed: %d row(s), cursor %q, want the saved c1 to stay", n, c)
		}
	})

	// Third review round, first finding: after a task-level error the sidecar aborts at the end of the run instead of
	// committing (closeActiveStreams(!cancelled && !isCriticalError())). A shared checkpoint that follows the error must not
	// commit anything either: a warehouse replace-table commit replaces the table with the partial batch, and aborting
	// afterwards cannot restore it.
	t.Run("after a task-level error nothing is committed at a shared checkpoint", func(t *testing.T) {
		a, b := &countingStream{}, &countingStream{}
		s := newSidecar("crashed", open("a", "incremental", bulker.ReplaceTable, a, 5), open("b", "full_refresh", bulker.ReplaceTable, b, 3))
		s.registerErr(errors.New("connector crashed"))
		s.processState(global("c1"))
		if a.commits != 0 || b.commits != 0 {
			t.Fatalf("commits after a task-level error: a=%d b=%d, want 0 and 0: a replace-table commit would replace the table with a partial batch", a.commits, b.commits)
		}
		if n := rows("crashed"); n != 0 {
			t.Fatalf("%d checkpoint row(s) saved after a task-level error, want 0", n)
		}
	})

	// Fourth review round, first finding: SIGTERM can arrive while the first commit at a shared checkpoint is in flight. The
	// end of the run then aborts instead of committing (closeActiveStreams(!cancelled ...)), so the loop must not start the
	// remaining commits: a replace-table commit would replace the table with the partial batch and the abort cannot undo it.
	t.Run("a cancellation during a shared checkpoint stops the remaining commits", func(t *testing.T) {
		b := &countingStream{}
		var s *ReadSideCar
		a := &cancellingStream{onCommit: func() { s.cancelled.Store(true) }}
		s = newSidecar("cancelled", open("a", "incremental", bulker.ReplaceTable, a, 5), open("b", "incremental", bulker.ReplaceTable, b, 3))
		s.processState(global("c1"))
		if a.commits != 1 {
			t.Errorf("stream a commits: %d, want 1 (its commit was already in flight when the cancellation arrived)", a.commits)
		}
		if b.commits != 0 {
			t.Errorf("stream b was committed %d time(s) after the task was cancelled, want 0: a replace-table commit would replace its table with a partial batch", b.commits)
		}
		if n := rows("cancelled"); n != 0 {
			t.Errorf("%d checkpoint row(s) saved while stream b's records are not committed, want 0", n)
		}
	})

	// Third review round, second finding: the webhook writer treats replace-table like batch and completing an empty stream
	// sends nothing, so an opened but empty stream has nothing to replace and the checkpoint must not wait for it. A
	// destination that does replace data (a warehouse) still waits.
	t.Run("an empty replace-table stream holds the checkpoint only for destinations that replace data", func(t *testing.T) {
		for _, tc := range []struct {
			destination string
			wantRows    int
		}{
			{"webhook", 1},  // nothing to replace: saved at once
			{"mixpanel", 1}, // same
			{"postgres", 0}, // replaces its table at the stream's completion: waits for it
		} {
			syncID := "dest-" + tc.destination
			a, b := &countingStream{}, &countingStream{}
			s := newSidecar(syncID, open("a", "incremental", bulker.ReplaceTable, a, 5), open("b", "incremental", bulker.ReplaceTable, b, 0))
			s.blk = typedBulker{typeID: tc.destination}
			s.processState(global("c1"))
			if a.commits != 1 {
				t.Errorf("%s: stream a commits: %d, want 1", tc.destination, a.commits)
			}
			if b.commits != 0 {
				t.Errorf("%s: the empty stream b was committed %d time(s) at the checkpoint, want 0", tc.destination, b.commits)
			}
			if n := rows(syncID); n != tc.wantRows {
				t.Errorf("%s: %d checkpoint row(s) saved with an empty replace-table stream open, want %d", tc.destination, n, tc.wantRows)
			}
		}
	})
}
