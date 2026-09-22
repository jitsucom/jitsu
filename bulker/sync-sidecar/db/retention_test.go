package db

import (
	"context"
	"os"
	"testing"

	"github.com/jackc/pgx/v5"
)

// A temporary table shadows production names on one dedicated connection.
// This also verifies cleanup works without Reverse ETL tables being installed.
func TestCleanupRetainsReverseDelivery(t *testing.T) {
	dsn := os.Getenv("SYNCCTL_TEST_DATABASE_URL")
	if dsn == "" {
		t.Skip("set SYNCCTL_TEST_DATABASE_URL to a disposable PostgreSQL database")
	}
	ctx := context.Background()
	conn, err := pgx.Connect(ctx, dsn)
	if err != nil {
		t.Fatal(err)
	}
	defer conn.Close(ctx)
	exec := func(sql string, args ...any) {
		t.Helper()
		if _, err := conn.Exec(ctx, sql, args...); err != nil {
			t.Fatal(err)
		}
	}
	exec(`CREATE TEMP TABLE source_task (
 task_id text PRIMARY KEY, sync_id text, started_at timestamptz, package text, status text, metrics jsonb)`)
	for _, tc := range []struct {
		id, pkg, status, metrics string
		keep                     bool
	}{
		{"failed-delivery", "jitsu/retl-runner", "FAILED", `{"reverseRecovery":{"runId":"saved"}}`, true},
		{"cancelled-delivery", "jitsu/retl-runner", "CANCELLED", `{"reverseRecovery":{"runId":"saved"}}`, true},
		{"pending", "jitsu/retl-runner", "PENDING", `{}`, true},
		{"running", "jitsu/retl-runner", "RUNNING", `{}`, true},
		{"waiting", "jitsu/retl-runner", "WAITING", `{}`, true},
		{"failed-unbound", "jitsu/retl-runner", "FAILED", `{}`, false},
		{"complete", "jitsu/retl-runner", "COMPLETE", `{}`, false},
		{"ordinary", "airbyte/source-test", "FAILED", `{"reverseRecovery":{"runId":"saved"}}`, false},
	} {
		t.Run(tc.id, func(t *testing.T) {
			exec(`TRUNCATE source_task`)
			exec(`INSERT INTO source_task VALUES
 ('newest','sync',now(),'airbyte/source-test','SUCCESS','{}'),
 ('cutoff','sync',now()-interval '90 days','airbyte/source-test','SUCCESS','{}'),
 ($1,'sync',now()-interval '100 days',$2,$3,$4)`, tc.id, tc.pkg, tc.status, tc.metrics)
			exec(cleanupTaskLogsSQL, 1, 60*86400)
			var exists bool
			if err := conn.QueryRow(ctx, `SELECT EXISTS(SELECT 1 FROM source_task WHERE task_id=$1)`, tc.id).Scan(&exists); err != nil {
				t.Fatal(err)
			}
			if exists != tc.keep {
				t.Fatalf("task retained=%v, want %v", exists, tc.keep)
			}
		})
	}
}
