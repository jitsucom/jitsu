package main

import (
	"context"
	"fmt"
	"net/http/httptest"
	"os"
	"testing"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/jitsucom/bulker/jitsubase/appbase"
	v1 "k8s.io/api/core/v1"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	"k8s.io/client-go/kubernetes/fake"
)

// Optional real SQL coverage: use a disposable PostgreSQL database. The test
// creates and drops only its own unique schema; no existing tables are touched.
func TestReverseRecoverySchedulerDatabase(t *testing.T) {
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
	schema := fmt.Sprintf("recovery_test_%d", time.Now().UnixNano())
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
	exec(`CREATE TABLE source_task(sync_id text,task_id text PRIMARY KEY,package text,version text,status text,
 started_at timestamptz DEFAULT now(),updated_at timestamptz DEFAULT now(),started_by jsonb,metrics jsonb,error text,description text);
 CREATE TABLE reverse_sync_control(workspace_id text,sync_id text,run_id text,revision text,phase text,
 PRIMARY KEY(workspace_id,sync_id,run_id));
 CREATE TABLE task_log(id text,level text,logger text,message text,sync_id text,task_id text)`)
	entry := reverseFixture()
	entry.Schedule = "0 0 * * *" // A daily model schedule must not delay recovery.
	client := fake.NewClientset()
	repo := testRepository{data: &SyncsData{Syncs: []*SyncEntry{entry}, BySyncID: map[string]*SyncEntry{entry.ID: entry}}}
	tm := &TaskManager{Service: appbase.NewServiceBase("recovery-test"), config: reverseTestConfig(), dbpool: pool,
		appContext: &Context{reverseRepo: repo}, jobRunner: &JobRunner{clientset: client, dbpool: pool}}
	exec(`INSERT INTO reverse_sync_control VALUES('workspace','sync','run',$1,'batches_pending')`, entry.Reverse.ConfigRevision)
	exec(`INSERT INTO source_task(sync_id,task_id,package,status,started_by,metrics)
 VALUES('sync','waiting','jitsu/retl-runner','WAITING','{"workspaceId":"workspace"}',
 jsonb_build_object('reverseRecovery',jsonb_build_object('runId','run','revision',$1::text,'attempt',0,'nextCheckAt',now()+interval '30 minutes')))`, entry.Reverse.ConfigRevision)
	podCount := func(want int) {
		t.Helper()
		pods, err := client.CoreV1().Pods("default").List(ctx, metav1.ListOptions{})
		if err != nil || len(pods.Items) != want {
			t.Fatalf("pods=%v, err=%v; want %d", len(pods.Items), err, want)
		}
	}
	tm.scheduleReverseRecovery()
	podCount(0)
	exec(`UPDATE source_task SET metrics=jsonb_set(metrics,'{reverseRecovery,nextCheckAt}',to_jsonb(now()-interval '1 minute'))`)
	tm.config.ReverseEnabled = false
	tm.scheduleReverseRecovery()
	podCount(0)
	tm.config.ReverseEnabled = true
	// Changed/deleted desired configurations must not be launched.
	oldRevision := entry.Reverse.ConfigRevision
	entry.Reverse.ConfigRevision = "changed"
	tm.scheduleReverseRecovery()
	podCount(0)
	entry.Reverse.ConfigRevision = oldRevision
	tm.scheduleReverseRecovery()
	tm.scheduleReverseRecovery()
	podCount(1)
	// The queued worker must survive cleanup although the original task is waiting.
	pods, _ := client.CoreV1().Pods("default").List(ctx, metav1.ListOptions{})
	first := pods.Items[0]
	if tm.jobRunner.endedReverseTasks(pods.Items)[first.Name] {
		t.Fatal("queued refresh was treated as ended")
	}
	exec(`UPDATE source_task SET status='PENDING',metrics=jsonb_set(metrics,'{reverseWorker}',
 jsonb_build_object('id',$1::text,'active',true)) WHERE task_id='waiting'`, first.Name)
	if tm.jobRunner.endedReverseTasks(pods.Items)[first.Name] {
		t.Fatal("active refresh was treated as ended")
	}
	exec(`UPDATE source_task SET metrics=jsonb_set(jsonb_set(metrics,'{reverseWorker,active}','false'),'{reverseRecovery,attempt}','1')`)
	if !tm.jobRunner.endedReverseTasks(pods.Items)[first.Name] {
		t.Fatal("finished refresh was not cleaned up")
	}
	tm.scheduleReverseRecovery()
	podCount(2)
	pods, _ = client.CoreV1().Pods("default").List(ctx, metav1.ListOptions{})
	var next v1.Pod
	for _, pod := range pods.Items {
		if pod.Name != first.Name {
			next = pod
		}
	}
	if tm.jobRunner.endedReverseTasks(pods.Items)[next.Name] {
		t.Fatal("next refresh was treated as ended")
	}
	exec(`UPDATE source_task SET metrics=jsonb_set(metrics,'{reverseWorker}',jsonb_build_object('id',$1::text,'active',true))`, next.Name)
	if err := tm.failReverseWorker(&TaskStatus{TaskDescriptor: TaskDescriptor{SyncID: "sync", TaskID: "waiting", StartedBy: `{"trigger":"recovery"}`}, PodName: first.Name}); err != nil {
		t.Fatal(err)
	}
	var status string
	if err := pool.QueryRow(ctx, "SELECT status FROM source_task WHERE task_id='waiting'").Scan(&status); err != nil || status != "PENDING" {
		t.Fatalf("late worker failure changed logical task: %s, %v", status, err)
	}
	// Terminal statuses and legacy idle attempts permit Pod cleanup.
	exec(`UPDATE source_task SET status='FAILED',metrics=jsonb_set(metrics,'{reverseWorker,active}','false')`)
	recorder := httptest.NewRecorder()
	request, _ := gin.CreateTestContext(recorder)
	tm.refreshReverseTask(request, ctx, entry, "waiting")
	if recorder.Code != 200 {
		t.Fatalf("manual refresh failed: %s", recorder.Body.String())
	}
	var count int
	if err := pool.QueryRow(ctx, "SELECT count(*) FROM source_task").Scan(&count); err != nil || count != 1 {
		t.Fatal("manual refresh created another task", err)
	}
	if err := pool.QueryRow(ctx, "SELECT status FROM source_task WHERE task_id='waiting'").Scan(&status); err != nil || status != "PENDING" {
		t.Fatal("manual refresh did not reopen original task", err)
	}
	podCount(3)
	for _, status := range []string{"COMPLETE", "WAITING", "RESUMED"} {
		exec("UPDATE source_task SET status=$1 WHERE task_id='waiting'", status)
		ended := tm.jobRunner.endedReverseTasks([]v1.Pod{{ObjectMeta: metav1.ObjectMeta{
			Name: "old-worker", Labels: map[string]string{labelSyncKind: "reverse"}, Annotations: map[string]string{"TaskID": "waiting", "SyncID": "sync"}}}})
		if !ended["old-worker"] {
			t.Fatalf("%s must be terminal for Pod cleanup", status)
		}
	}
	// A pre-start failure (including lease contention) advances only this check,
	// leaves delivery pending, and logs once even if a late notification repeats.
	exec(`UPDATE source_task SET status='PENDING',metrics=jsonb_set(jsonb_set(metrics #- '{reverseRecovery,previousStatus}',
 '{reverseWorker}','{"id":"prior-worker","active":false}'),'{reverseRecovery,attempt}','5')`)
	failedWorker := reverseResourceName(entry.ID + ":refresh:waiting:5")
	failedStatus := &TaskStatus{TaskDescriptor: TaskDescriptor{
		SyncID: "sync", TaskID: "waiting", StartedBy: `{"trigger":"recovery"}`}, PodName: failedWorker}
	for i := 0; i < 2; i++ {
		if err := tm.failReverseWorker(failedStatus); err != nil {
			t.Fatal(err)
		}
	}
	var attempt int
	if err := pool.QueryRow(ctx, `SELECT status,(metrics->'reverseRecovery'->>'attempt')::int
 FROM source_task WHERE task_id='waiting'`).Scan(&status, &attempt); err != nil || status != "PENDING" || attempt != 6 {
		t.Fatalf("startup failure lost pending run: %s attempt=%d err=%v", status, attempt, err)
	}
	if err := pool.QueryRow(ctx, "SELECT count(*) FROM task_log WHERE level='ERROR' AND task_id='waiting'").Scan(&count); err != nil || count != 1 {
		t.Fatalf("startup failure log count=%d err=%v", count, err)
	}
	// Suspended checks are never automatically relaunched, even when overdue.
	exec(`UPDATE source_task SET metrics=jsonb_set(jsonb_set(metrics,'{reverseRecovery,suspended}','true'),
 '{reverseRecovery,nextCheckAt}',to_jsonb(now()-interval '1 minute'))`)
	tm.scheduleReverseRecovery()
	podCount(3)
	// Explicit retry clears suspension, retains the task, and gets a new worker identity.
	recorder = httptest.NewRecorder()
	request, _ = gin.CreateTestContext(recorder)
	tm.refreshReverseTask(request, ctx, entry, "waiting")
	if recorder.Code != 200 {
		t.Fatalf("explicit retry: %s", recorder.Body.String())
	}
	podCount(4)
	if err := pool.QueryRow(ctx, "SELECT count(*) FROM source_task").Scan(&count); err != nil || count != 1 {
		t.Fatal("explicit retry duplicated task", err)
	}
	// Repeated explicit retries must not reuse a completed worker generation at 100.
	exec(`UPDATE source_task SET status='FAILED',metrics=jsonb_set(metrics #- '{reverseRecovery,previousStatus}','{reverseRecovery,attempt}','100')`)
	recorder = httptest.NewRecorder()
	request, _ = gin.CreateTestContext(recorder)
	tm.refreshReverseTask(request, ctx, entry, "waiting")
	if recorder.Code != 200 {
		t.Fatalf("attempt 101: %s", recorder.Body.String())
	}
	if err := pool.QueryRow(ctx, "SELECT (metrics->'reverseRecovery'->>'attempt')::int FROM source_task").Scan(&attempt); err != nil || attempt != 101 {
		t.Fatalf("worker generation did not advance past 100: %d err=%v", attempt, err)
	}
	worker101 := reverseResourceName(entry.ID + ":refresh:waiting:101")
	if err := tm.failReverseWorker(&TaskStatus{TaskDescriptor: TaskDescriptor{
		SyncID: "sync", TaskID: "waiting", StartedBy: `{"trigger":"recovery"}`}, PodName: worker101}); err != nil {
		t.Fatal(err)
	}
	if err := pool.QueryRow(ctx, "SELECT status,(metrics->'reverseRecovery'->>'attempt')::int FROM source_task").Scan(&status, &attempt); err != nil || status != "FAILED" || attempt != 102 {
		t.Fatalf("retry failure changed original status or reused worker: %s %d err=%v", status, attempt, err)
	}
	// Cancellation does not need a Pod, desired entry, or enabled rollout.
	tm.config.ReverseEnabled = false
	tm.appContext.reverseRepo = nil
	for _, initial := range []string{"WAITING", "RUNNING", "PENDING"} {
		exec("UPDATE source_task SET status=$1 WHERE task_id='waiting'", initial)
		for _, workspace := range []string{"foreign", "workspace"} {
			recorder := httptest.NewRecorder()
			c, _ := gin.CreateTestContext(recorder)
			c.Request = httptest.NewRequest("GET", "/cancel?syncId=sync&taskId=waiting&workspaceId="+workspace, nil)
			tm.ReverseCancelHandler(c)
			if recorder.Code != 200 {
				t.Fatalf("cancel failed: %s", recorder.Body.String())
			}
			if err := pool.QueryRow(ctx, "SELECT status FROM source_task WHERE task_id='waiting'").Scan(&status); err != nil {
				t.Fatal(err)
			}
			want := initial
			if workspace == "workspace" {
				want = "CANCELLED"
			}
			if status != want {
				t.Fatalf("%s cancel from %s got %s, want %s", initial, workspace, status, want)
			}
		}
	}
}
