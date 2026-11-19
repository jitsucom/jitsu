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

// writerBulker is a destination of a given type that creates counting writers, so a test can drive the real openStream.
type writerBulker struct {
	typedBulker
	created *[]*countingStream
	modes   *[]bulker.BulkMode
}

func (b writerBulker) CreateStream(_, _ string, mode bulker.BulkMode, _ ...bulker.StreamOption) (bulker.BulkerStream, error) {
	c := &countingStream{}
	*b.created = append(*b.created, c)
	*b.modes = append(*b.modes, mode)
	return c, nil
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
		if b.commits != 0 {
			t.Fatalf("stream b was committed %d time(s) at a checkpoint that cannot advance (a's replacement is pending), want 0: it replaces b's table with a partial batch and the cursor is not saved", b.commits)
		}
		// A's table has not been replaced yet. The checkpoint must not be saved past it, see the next case.
		if n := rows("empty"); n != 0 {
			t.Fatalf("%d checkpoint row(s) saved while stream a's table replacement is still pending, want 0", n)
		}
		s.closeActiveStreams(true)
		if a.commits != 1 || b.commits != 1 {
			t.Fatalf("commits after the close: a=%d b=%d, want 1 and 1 (each stream's own completion handles it)", a.commits, b.commits)
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

	// Fifth review round: the connector logged an error while stream A was the only running stream, so the error is recorded
	// on A (errorFromLogs) and not as a task-level error. A strict commit aborts such a stream, and the end of the run closes
	// strictly. A shared checkpoint must not commit it non-strictly: on a replace-table stream that replaces the warehouse
	// table with the partial batch, and the later strict close cannot undo it.
	t.Run("a stream with an error from the connector logs is left for its strict close", func(t *testing.T) {
		a, b := &countingStream{}, &countingStream{}
		sa := open("a", "incremental", bulker.ReplaceTable, a, 5)
		sa.errorFromLogs = "connector logged an error while only this stream was running"
		s := newSidecar("logerr", sa, open("b", "incremental", bulker.ReplaceTable, b, 3))
		s.processState(global("c1"))
		if a.commits != 0 {
			t.Errorf("stream a was committed %d time(s) at the checkpoint although the connector logged an error for it, want 0: a replace-table commit would replace its table with a partial batch", a.commits)
		}
		if b.commits != 0 {
			t.Errorf("stream b was committed %d time(s) at a checkpoint that cannot advance (a is left for its strict close), want 0", b.commits)
		}
		if n := rows("logerr"); n != 0 {
			t.Errorf("%d checkpoint row(s) saved while stream a's records are not committed, want 0", n)
		}
		// the end of the run closes strictly: A is aborted and carries the error, so the checkpoint is never saved
		s.closeActiveStreams(true)
		if a.commits != 0 || a.aborts != 1 || b.commits != 1 {
			t.Errorf("after the strict close: stream a commits=%d aborts=%d, stream b commits=%d, want 0, 1 and 1", a.commits, a.aborts, b.commits)
		}
		if sa.Error == "" {
			t.Errorf("stream a has no error after the strict close, want the logged error")
		}
		if n := rows("logerr"); n != 0 {
			t.Errorf("%d checkpoint row(s) saved after stream a was aborted, want 0", n)
		}
	})

	// Sixth review round, first finding: an incremental stream A with a partial batch in replace-table mode (state was reset)
	// next to a full-refresh stream B that has not committed. B keeps the checkpoint from being saved, so replacing A's table
	// now would leave readers with the partial batch if the run is cancelled before A finishes, with no progress saved. A
	// replace-table stream is committed at a shared checkpoint only when the checkpoint can then be saved.
	t.Run("a table is not replaced at a checkpoint that cannot be saved", func(t *testing.T) {
		a, b := &countingStream{}, &countingStream{}
		s := newSidecar("blocked", open("a", "incremental", bulker.ReplaceTable, a, 5), open("b", "full_refresh", bulker.ReplaceTable, b, 3))
		s.processState(global("c1"))
		if a.commits != 0 || b.commits != 0 {
			t.Errorf("commits at a checkpoint that cannot be saved: a=%d b=%d, want 0 and 0: a replace-table commit would replace a table with a partial batch and save no progress", a.commits, b.commits)
		}
		if n := rows("blocked"); n != 0 {
			t.Errorf("%d checkpoint row(s) saved while stream b is still buffering, want 0", n)
		}
		// cancelled before a finishes: nothing was replaced
		s.cancelled.Store(true)
		s.closeActiveStreams(false)
		if a.commits != 0 || b.commits != 0 {
			t.Errorf("commits after the cancelled run: a=%d b=%d, want 0 and 0", a.commits, b.commits)
		}
	})

	// Sixth review round, second finding: the guard for a stream with a logged connector error is only for commits that replace
	// existing data. A batch-mode commit appends, so it is committed at the checkpoint as before.
	t.Run("a batch stream with a logged connector error is still committed at a checkpoint", func(t *testing.T) {
		a, b := &countingStream{}, &countingStream{}
		sa := open("a", "incremental", bulker.Batch, a, 5)
		sa.errorFromLogs = "connector logged an error while only this stream was running"
		s := newSidecar("batchlogerr", sa, open("b", "incremental", bulker.Batch, b, 3))
		s.processState(global("c1"))
		if a.commits != 1 || b.commits != 1 {
			t.Errorf("commits: a=%d b=%d, want 1 and 1: a batch commit only appends rows and was committed at checkpoints before", a.commits, b.commits)
		}
		if n := rows("batchlogerr"); n != 1 {
			t.Errorf("%d checkpoint row(s) saved, want 1", n)
		}
	})

	// Seventh review round, first finding: stream B failed its upload when it was committed. The failed commit clears its
	// writer and sets its error, and the cursor will be refused because of that error, so the checkpoint cannot advance. A
	// replace-table commit of stream A would still replace its table with a partial batch.
	t.Run("a table is not replaced when a closed stream has failed", func(t *testing.T) {
		a := &countingStream{}
		failing := &countingStream{rejectingStream: rejectingStream{err: errAddressNotAllowed}}
		sb := open("b", "incremental", bulker.ReplaceTable, failing, 3)
		sb.Commit(false) // the upload fails: sb.Error is set and its writer is gone
		if sb.Error == "" || sb.bulkerStream != nil {
			t.Fatalf("setup: stream b error %q, writer set %v, want an error and no writer", sb.Error, sb.bulkerStream != nil)
		}
		s := newSidecar("closedfailed", open("a", "incremental", bulker.ReplaceTable, a, 5), sb)
		s.processState(global("c1"))
		if a.commits != 0 {
			t.Errorf("stream a was committed %d time(s) although stream b has failed and the checkpoint will be refused, want 0: a replace-table commit would replace its table with a partial batch", a.commits)
		}
		if n := rows("closedfailed"); n != 0 {
			t.Errorf("%d checkpoint row(s) saved with a failed stream, want 0", n)
		}
	})

	// Seventh review round, audit: the answer to "can the checkpoint advance" can change during the pass. If a commit fails,
	// the commits that replace a table and have not started must not start.
	t.Run("a failed commit in the pass stops the table replacements after it", func(t *testing.T) {
		a := &countingStream{rejectingStream: rejectingStream{err: errAddressNotAllowed}}
		b := &countingStream{}
		s := newSidecar("midpass", open("a", "incremental", bulker.ReplaceTable, a, 5), open("b", "incremental", bulker.ReplaceTable, b, 3))
		s.processState(global("c1"))
		if a.commits != 1 {
			t.Errorf("stream a commits: %d, want 1 (the failing one)", a.commits)
		}
		if b.commits != 0 {
			t.Errorf("stream b was committed %d time(s) after stream a's commit failed, want 0: its table would be replaced and the cursor refused", b.commits)
		}
	})

	// Audit: the size limit is part of the rule (it bounds memory), so a stream at the limit is committed even when the
	// checkpoint cannot be saved.
	t.Run("a stream at the size limit is committed even when the checkpoint cannot advance", func(t *testing.T) {
		a, b := &countingStream{}, &countingStream{}
		s := newSidecar("limit", open("a", "incremental", bulker.ReplaceTable, a, checkpointEventsLimit), open("b", "full_refresh", bulker.ReplaceTable, b, 3))
		s.processState(global("c1"))
		if a.commits != 1 || b.commits != 0 {
			t.Errorf("commits: a=%d b=%d, want 1 and 0: a at the size limit commits to bound memory, b is not due", a.commits, b.commits)
		}
	})

	// Seventh review round, second finding: a stream that committed once is opened again in batch mode, but its recorded
	// mode stayed replace-table. The rules for replacements then treated its append batch as a replacement.
	t.Run("a stream opened again after a commit is in batch mode", func(t *testing.T) {
		var created []*countingStream
		var modes []bulker.BulkMode
		props := jsonorder.NewOrderedMap[string, any](0)
		s := newSidecar("reopen")
		s.blk = writerBulker{typedBulker: typedBulker{typeID: "postgres"}, created: &created, modes: &modes}
		s.catalog.Set("a", &Stream{StreamMeta: &StreamMeta{Name: "a", JSONSchema: StreamJsonSchema{Properties: props}}, SyncMode: "incremental"})
		first, err := s.openStream("a")
		if err != nil {
			t.Fatal(err)
		}
		if first.bulkerMode != bulker.ReplaceTable {
			t.Fatalf("first writer mode %v, want replace-table (no saved state)", first.bulkerMode)
		}
		first.bufferedEventsCount = 5
		first.Commit(false) // the first batch replaced the table
		again, err := s.openStream("a")
		if err != nil {
			t.Fatal(err)
		}
		if len(modes) != 2 || modes[1] != bulker.Batch {
			t.Fatalf("writer modes %v, want the second writer in batch mode", modes)
		}
		if again.bulkerMode != bulker.Batch {
			t.Errorf("recorded mode of the stream after it was opened again: %v, want batch (the mode its writer was created with)", again.bulkerMode)
		}
		// the append batch is committed at a checkpoint that a full-refresh stream keeps from advancing
		again.bufferedEventsCount = 2
		sb := open("b", "full_refresh", bulker.ReplaceTable, &countingStream{}, 3)
		s.processedStreams["b"] = sb
		s.processState(global("c1"))
		if created[1].commits != 1 {
			t.Errorf("the append batch of stream a commits: %d, want 1: it only appends and does not wait for stream b", created[1].commits)
		}
	})

	// Third review round, second finding: the webhook writer treats replace-table like batch and completing an empty stream
	// sends nothing, so an opened but empty stream has nothing to replace and the checkpoint must not wait for it. A
	// destination that does replace data (a warehouse) still waits.
	t.Run("an empty replace-table stream holds the checkpoint only for destinations that replace data", func(t *testing.T) {
		for _, tc := range []struct {
			destination  string
			wantRows     int
			wantACommits int
		}{
			{"webhook", 1, 1},  // nothing to replace: a commits and the checkpoint is saved at once
			{"mixpanel", 1, 1}, // same
			{"postgres", 0, 0}, // b's table replacement is pending, so the checkpoint cannot advance and a waits for its own close
		} {
			syncID := "dest-" + tc.destination
			a, b := &countingStream{}, &countingStream{}
			s := newSidecar(syncID, open("a", "incremental", bulker.ReplaceTable, a, 5), open("b", "incremental", bulker.ReplaceTable, b, 0))
			s.blk = typedBulker{typeID: tc.destination}
			s.processState(global("c1"))
			if a.commits != tc.wantACommits {
				t.Errorf("%s: stream a commits: %d, want %d", tc.destination, a.commits, tc.wantACommits)
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
