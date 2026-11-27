package main

import (
	"context"
	"fmt"
	"net/http"
	"net/http/httptest"
	"net/url"
	"os"
	"testing"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/jitsucom/bulker/jitsubase/appbase"
	"k8s.io/client-go/kubernetes/fake"
)

// The console proves that the sync belongs to the workspace and passes the task id along. The cancel handler must therefore
// only change a task of THAT sync: a task id of another sync, which may belong to another workspace, has to stay as it is.
//
// Optional real SQL coverage, like the other tests of this package: it needs a disposable PostgreSQL database, creates its
// own unique schema and drops it, and touches no existing table.
func TestCancelOnlyChangesTasksOfTheAuthorizedSync(t *testing.T) {
	dsn := os.Getenv("SYNCCTL_TEST_DATABASE_URL")
	if dsn == "" {
		t.Skip("set SYNCCTL_TEST_DATABASE_URL to a disposable PostgreSQL database")
	}
	ctx := context.Background()
	admin, err := pgxpool.New(ctx, dsn)
	if err != nil {
		t.Fatal(err)
	}
	defer admin.Close()
	schema := fmt.Sprintf("cancel_scope_test_%d", time.Now().UnixNano())
	if _, err = admin.Exec(ctx, "CREATE SCHEMA "+schema); err != nil {
		t.Fatal(err)
	}
	defer func() { _, _ = admin.Exec(ctx, "DROP SCHEMA "+schema+" CASCADE") }()
	cfg, err := pgxpool.ParseConfig(dsn)
	if err != nil {
		t.Fatal(err)
	}
	cfg.ConnConfig.RuntimeParams["search_path"] = schema
	pool, err := pgxpool.NewWithConfig(ctx, cfg)
	if err != nil {
		t.Fatal(err)
	}
	defer pool.Close()
	exec := func(sql string, args ...any) {
		t.Helper()
		if _, err := pool.Exec(ctx, sql, args...); err != nil {
			t.Fatal(err)
		}
	}
	status := func(taskID string) string {
		t.Helper()
		var s string
		if err := pool.QueryRow(ctx, `SELECT status FROM source_task WHERE task_id=$1`, taskID).Scan(&s); err != nil {
			t.Fatal(err)
		}
		return s
	}
	reset := func() {
		t.Helper()
		exec(`TRUNCATE source_task`)
		exec(`INSERT INTO source_task(sync_id,task_id,package,version,status) VALUES
 ('sync-a','task-a','airbyte/source-test','1','RUNNING'),
 ('sync-b','task-b','airbyte/source-test','1','RUNNING'),
 ('sync-a','task-a-done','airbyte/source-test','1','COMPLETE'),
 ('sync-a','task-a-failed','airbyte/source-test','1','FAILED')`)
	}
	exec(`CREATE TABLE source_task(sync_id text,task_id text PRIMARY KEY,package text,version text,status text,
 started_at timestamptz DEFAULT now(),updated_at timestamptz DEFAULT now(),started_by jsonb,metrics jsonb,error text,description text)`)

	tm := &TaskManager{
		Service:   appbase.NewServiceBase("cancel-scope-test"),
		config:    reverseTestConfig(),
		dbpool:    pool,
		jobRunner: &JobRunner{Service: appbase.NewServiceBase("cancel-scope-test"), clientset: fake.NewClientset(), namespace: "default"},
	}
	gin.SetMode(gin.TestMode)
	cancel := func(syncID, taskID string) {
		t.Helper()
		w := httptest.NewRecorder()
		c, _ := gin.CreateTestContext(w)
		q := url.Values{"workspaceId": {"ws"}, "syncId": {syncID}, "taskId": {taskID}, "package": {"airbyte/source-test"}}
		c.Request = httptest.NewRequest(http.MethodGet, "/cancel?"+q.Encode(), nil)
		tm.CancelHandler(c)
		// the answer is the same whatever the task: the caller learns nothing about tasks of other syncs
		if w.Code != http.StatusOK {
			t.Fatalf("cancel answered %d, want 200", w.Code)
		}
	}

	t.Run("a task of another sync is left running", func(t *testing.T) {
		reset()
		cancel("sync-a", "task-b")
		if got := status("task-b"); got != "RUNNING" {
			t.Fatalf("task-b of sync-b is %s after a cancel for sync-a, want RUNNING", got)
		}
		if got := status("task-a"); got != "RUNNING" {
			t.Fatalf("task-a is %s, want RUNNING: the cancel named another task", got)
		}
	})
	t.Run("a task of the authorized sync is cancelled and the other sync is not touched", func(t *testing.T) {
		reset()
		cancel("sync-a", "task-a")
		if got := status("task-a"); got != "CANCELLED" {
			t.Fatalf("task-a is %s, want CANCELLED", got)
		}
		if got := status("task-b"); got != "RUNNING" {
			t.Fatalf("task-b is %s, want RUNNING", got)
		}
	})
	t.Run("a finished task keeps its status", func(t *testing.T) {
		reset()
		cancel("sync-a", "task-a-done")
		cancel("sync-a", "task-a-failed")
		if got := status("task-a-done"); got != "COMPLETE" {
			t.Fatalf("task-a-done is %s, want COMPLETE", got)
		}
		if got := status("task-a-failed"); got != "FAILED" {
			t.Fatalf("task-a-failed is %s, want FAILED", got)
		}
	})
	t.Run("an empty sync id or task id changes nothing", func(t *testing.T) {
		reset()
		cancel("", "task-a")
		cancel("sync-a", "")
		cancel("", "")
		for _, id := range []string{"task-a", "task-b"} {
			if got := status(id); got != "RUNNING" {
				t.Fatalf("%s is %s after cancels with a missing id, want RUNNING", id, got)
			}
		}
	})
}
