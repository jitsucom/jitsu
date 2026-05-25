package main

import (
	"context"
	"encoding/json"
	"net/http"
	"strings"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/jitsucom/bulker/jitsubase/appbase"
	"github.com/jitsucom/bulker/jitsubase/safego"
	"github.com/jitsucom/bulker/sync-sidecar/db"
)

type TaskManager struct {
	appbase.Service
	config    *Config
	jobRunner *JobRunner
	syncsRepo appbase.Repository[SyncsData]
	dbpool    *pgxpool.Pool
	closeCh   chan struct{}
}

func NewTaskManager(appContext *Context) (*TaskManager, error) {
	base := appbase.NewServiceBase("task-manager")
	t := &TaskManager{
		Service:   base,
		config:    appContext.config,
		jobRunner: appContext.jobRunner,
		syncsRepo: appContext.syncsRepo,
		dbpool:    appContext.dbpool,
		closeCh:   make(chan struct{}),
	}
	safego.RunWithRestart(t.listenTaskStatus)
	// Retention sweep runs on its own goroutine so it can't back-pressure
	// status consumption when a global windowed delete takes a while —
	// jobRunner.sendStatus drops events after a 5s blocked send.
	safego.RunWithRestart(t.runRetentionSweeper)
	return t, nil
}

// inlineRequestBody is the schema accepted by SpecHandler / CheckHandler /
// DiscoverHandler (inline variant). Mirrors SyncEntry's shape so the same
// init-container chain consumes both.
type inlineRequestBody struct {
	// Source is the wrapper {package, version, authorized, credentials}.
	// Same shape as SyncEntry.Source — oauth-refresh reads it from
	// /config/serviceConfig.json. Required for check/discover. Optional
	// for spec.
	Source            json.RawMessage `json:"source"`
	DestinationConfig json.RawMessage `json:"destinationConfig"`
}

// parseUpdatedAtQuery reads the optional ?updatedAt= query parameter that
// console attaches to /run + /discover so syncctl can wait for repository
// parity. Returns zero time on absent/invalid input — WaitForSyncEntry treats
// that as "any entry is fine".
func parseUpdatedAtQuery(c *gin.Context) time.Time {
	raw := c.Query("updatedAt")
	if raw == "" {
		return time.Time{}
	}
	if t, err := time.Parse(time.RFC3339Nano, raw); err == nil {
		return t
	}
	if t, err := time.Parse(time.RFC3339, raw); err == nil {
		return t
	}
	return time.Time{}
}

// resolveSyncEntry waits for the repository to contain a SyncEntry with
// UpdatedAt >= minUpdatedAt. The 30s ceiling matches the longest poll cycle
// we'd reasonably tolerate before deciding the console-side updatedAt is wrong.
func (t *TaskManager) resolveSyncEntry(c *gin.Context, syncID string) (*SyncEntry, error) {
	ctx, cancel := context.WithTimeout(c.Request.Context(), 30*time.Second)
	defer cancel()
	return WaitForSyncEntry(ctx, t.syncsRepo, syncID, parseUpdatedAtQuery(c))
}

// SpecHandler handles GET /spec?package=X&version=Y. No body.
func (t *TaskManager) SpecHandler(c *gin.Context) {
	pc := PodCtx{
		TaskType: "spec",
		Inline: &InlinePayload{
			Package: c.Query("package"),
			Version: c.Query("version"),
		},
	}
	ts := t.jobRunner.CreatePod(pc)
	if ts.Status == StatusCreateFailed {
		c.JSON(http.StatusOK, gin.H{"ok": false, "error": ts.Error})
		return
	}
	c.JSON(http.StatusOK, gin.H{"ok": true, "taskId": ts.PodName})
}

// CheckHandler handles POST /check?package=X&version=Y&storageKey=Z body
// {source, destinationConfig?}. Source is the {package,version,authorized,credentials}
// wrapper.
func (t *TaskManager) CheckHandler(c *gin.Context) {
	body := inlineRequestBody{}
	if err := c.BindJSON(&body); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"ok": false, "error": err.Error()})
		return
	}
	if len(body.Source) == 0 {
		c.JSON(http.StatusBadRequest, gin.H{"ok": false, "error": "missing 'source' in body"})
		return
	}
	pc := PodCtx{
		TaskType:   "check",
		StorageKey: c.Query("storageKey"),
		Inline: &InlinePayload{
			Package:           c.Query("package"),
			Version:           c.Query("version"),
			StorageKey:        c.Query("storageKey"),
			Source:            body.Source,
			DestinationConfig: body.DestinationConfig,
		},
	}
	ts := t.jobRunner.CreatePod(pc)
	if ts.Status == StatusCreateFailed {
		c.JSON(http.StatusOK, gin.H{"ok": false, "error": ts.Error})
		return
	}
	c.JSON(http.StatusOK, gin.H{"ok": true, "taskId": ts.PodName})
}

// DiscoverHandler handles POST /discover. Two modes:
//   - sync-bound: ?syncId=X&updatedAt=T — syncctl looks up the SyncEntry.
//   - inline:    ?package=X&version=Y body {source}
//
// thenRun is intentionally not honored: when a sync needs schema refresh
// before a run, the read Pod includes the discover step as an init container
// (driven by SyncEntry.Options.schemaChanges) — there's no separate
// discover-then-read handoff anymore.
func (t *TaskManager) DiscoverHandler(c *gin.Context) {
	syncID := c.Query("syncId")
	pc := PodCtx{
		TaskType:    "discover",
		WorkspaceID: c.Query("workspaceId"),
		SyncID:      syncID,
		TaskID:      c.Query("taskId"),
		StorageKey:  c.Query("storageKey"),
		StartedBy:   c.Query("startedBy"),
		FullSync:    c.Query("fullSync"),
	}
	if syncID != "" {
		entry, err := t.resolveSyncEntry(c, syncID)
		if err != nil {
			t.Warnf("DiscoverHandler: resolveSyncEntry %s: %v", syncID, err)
			if entry == nil {
				c.JSON(http.StatusServiceUnavailable, gin.H{"ok": false, "error": err.Error()})
				return
			}
			// timed-out-but-have-stale-entry — proceed with what we have.
		}
		pc.Entry = entry
	} else {
		body := inlineRequestBody{}
		if err := c.BindJSON(&body); err != nil {
			c.JSON(http.StatusBadRequest, gin.H{"ok": false, "error": err.Error()})
			return
		}
		if len(body.Source) == 0 {
			c.JSON(http.StatusBadRequest, gin.H{"ok": false, "error": "missing 'source' in body (inline discover requires it)"})
			return
		}
		pc.Inline = &InlinePayload{
			Package:    c.Query("package"),
			Version:    c.Query("version"),
			StorageKey: c.Query("storageKey"),
			Source:     body.Source,
		}
	}
	ts := t.jobRunner.CreatePod(pc)
	if ts.Status == StatusCreateFailed {
		c.JSON(http.StatusOK, gin.H{"ok": false, "error": ts.Error})
		return
	}
	c.JSON(http.StatusOK, gin.H{"ok": true, "taskId": ts.PodName})
}

// ReadHandler handles POST /read?syncId=X&updatedAt=T&taskId=Y&fullSync=...&debug=...
// No body — all config is sourced from the SyncEntry. Console must pass its
// known updatedAt so syncctl waits for repo parity before reading config.
func (t *TaskManager) ReadHandler(c *gin.Context) {
	syncID := c.Query("syncId")
	if syncID == "" {
		c.JSON(http.StatusBadRequest, gin.H{"ok": false, "error": "missing syncId"})
		return
	}
	t.Infof("ReadHandler: syncId=%s taskId=%s fullSync=%s startedBy=%s",
		syncID, c.Query("taskId"), c.Query("fullSync"), c.Query("startedBy"))

	// Admission gate: fail-fast if a Lease is currently held for this sync —
	// either a cron-spawned Pod is running, or another manual run hasn't
	// released its lease yet. Avoids spawning a second Pod that would
	// promptly self-exit at the lease-acquire init container anyway.
	if held, err := IsSyncLeaseHeld(t.jobRunner.clientset, t.config.KubernetesNamespace, syncID); err != nil {
		t.Warnf("admission lease check failed for sync %s: %v (allowing run)", syncID, err)
	} else if held {
		t.Infof("ReadHandler: rejecting syncId=%s — lease already held", syncID)
		c.JSON(http.StatusConflict, gin.H{"ok": false, "error": "sync is already running (lease held)", "syncId": syncID})
		return
	}

	entry, err := t.resolveSyncEntry(c, syncID)
	if err != nil {
		t.Warnf("ReadHandler: resolveSyncEntry %s: %v", syncID, err)
		if entry == nil {
			c.JSON(http.StatusServiceUnavailable, gin.H{"ok": false, "error": err.Error()})
			return
		}
	}

	pc := PodCtx{
		TaskType:    "read",
		WorkspaceID: entry.WorkspaceID,
		SyncID:      entry.ID,
		TaskID:      c.Query("taskId"),
		StartedBy:   c.Query("startedBy"),
		FullSync:    c.Query("fullSync"),
		Debug:       c.Query("debug"),
		Entry:       entry,
	}
	ts := t.jobRunner.CreatePod(pc)
	if ts.Status == StatusCreateFailed {
		t.Errorf("ReadHandler: CreatePod failed for syncId=%s: %s", syncID, ts.Error)
		c.JSON(http.StatusOK, gin.H{"ok": false, "error": ts.Error})
		return
	}
	t.Infof("ReadHandler: created pod for syncId=%s status=%s pod=%s",
		syncID, ts.Status, ts.PodName)
	c.JSON(http.StatusOK, gin.H{"ok": true, "taskId": ts.PodName})
}

func (t *TaskManager) CancelHandler(c *gin.Context) {
	pkg := c.Query("package")
	syncId := c.Query("syncId")
	taskId := c.Query("taskId")
	t.Infof("Canceling read and discover tasks for syncId: %s, taskId: %s, package: %s", syncId, taskId, pkg)
	_ = db.UpdateRunningTaskStatus(t.dbpool, taskId, "CANCELLED")
	t.jobRunner.TerminatePod(PodName(syncId, taskId, pkg, "discover"))
	t.jobRunner.TerminatePod(PodName(syncId, taskId, pkg, "read"))
	c.JSON(http.StatusOK, gin.H{"ok": true})
}

func (t *TaskManager) listenTaskStatus() {
	staleTicker := time.NewTicker(15 * time.Minute)
	defer staleTicker.Stop()
	for {
		select {
		case <-t.closeCh:
			return
		case <-staleTicker.C:
			if err := db.CloseStaleTasks(t.dbpool, time.Now().Add(-time.Hour)); err != nil {
				t.Errorf("Unable to close stale tasks: %v", err)
			}
		case st := <-t.jobRunner.TaskStatusChannel():
			var err error
			switch st.TaskType {
			case "spec":
				if st.Status == StatusCreateFailed || st.Status == StatusFailed || st.Status == StatusInitTimeout {
					err = db.InsertSpecError(t.dbpool, st.Package, st.PackageVersion, st.StartedAtTime(), st.Error)
				}
			case "discover":
				if st.Status == StatusCreateFailed || st.Status == StatusFailed || st.Status == StatusInitTimeout {
					err = db.UpsertRunningCatalogStatus(t.dbpool, st.Package, st.PackageVersion, st.StorageKey, st.StartedAtTime(), "FAILED", st.Error)
				} else if st.Status == StatusCreated {
					err = db.UpsertCatalogStatus(t.dbpool, st.Package, st.PackageVersion, st.StorageKey, st.StartedAtTime(), "RUNNING", "")
				}
			case "check":
				if st.Status == StatusCreateFailed || st.Status == StatusFailed || st.Status == StatusInitTimeout {
					err = db.InsertCheckError(t.dbpool, st.Package, st.PackageVersion, st.StorageKey, "FAILED", strings.Join([]string{string(st.Status), st.Error}, ": "), st.StartedAtTime())
				}
			case "read":
				switch st.Status {
				case StatusCreateFailed, StatusFailed, StatusInitTimeout:
					err = db.UpsertRunningTask(t.dbpool, st.SyncID, st.TaskID, st.Package, st.PackageVersion, st.StartedAtTime(), "FAILED", strings.Join([]string{string(st.Status), st.Error}, ": "), st.StartedBy)
				case StatusCreated:
					err = db.UpsertRunningTask(t.dbpool, st.SyncID, st.TaskID, st.Package, st.PackageVersion, st.StartedAtTime(), "RUNNING", "", st.StartedBy)
				case StatusRunning, StatusPending:
					if len(st.Metrics) > 0 {
						err = db.UpdateRunningTaskMetrics(t.dbpool, st.TaskID, st.Metrics)
					} else {
						err = db.UpdateRunningTaskDate(t.dbpool, st.TaskID)
					}
				default:
					//do nothing. sidecar manages success status.
				}
			}
			if err != nil {
				t.Errorf("Unable to update '%s' status: %v\n", st.TaskType, err)
			}
			if st.Status != StatusPending {
				t.Infof("taskStatus: %+v\n", *st)
			} else {
				t.Debugf("taskStatus: %+v\n", *st)
			}
		}
	}
}

// runRetentionSweeper performs the hourly source_task retention sweep on its
// own goroutine. The global windowed DELETE can take a while; keeping it off
// listenTaskStatus's select loop ensures status updates from the watcher
// continue to drain even mid-sweep. Replaces the per-request cleanup that
// used to fire on every /sources/run hit in console.
func (t *TaskManager) runRetentionSweeper() {
	cleanupTicker := time.NewTicker(time.Hour)
	defer cleanupTicker.Stop()
	for {
		select {
		case <-t.closeCh:
			return
		case <-cleanupTicker.C:
			deleted, err := db.CleanupTaskLogs(t.dbpool, t.config.TaskLogKeepPerSync, time.Duration(t.config.TaskLogMaxAgeDays)*24*time.Hour)
			if err != nil {
				t.Errorf("source_task retention sweep failed: %v", err)
			} else if deleted > 0 {
				t.Infof("source_task retention sweep: deleted %d row(s)", deleted)
			}
		}
	}
}

func (t *TaskManager) Close() {
	select {
	case <-t.closeCh:
	default:
		close(t.closeCh)
	}
}

