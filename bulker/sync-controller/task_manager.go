package main

import (
	"fmt"
	"strings"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/jitsucom/bulker/jitsubase/appbase"
	"github.com/jitsucom/bulker/jitsubase/jsonorder"
	"github.com/jitsucom/bulker/jitsubase/safego"
	"github.com/jitsucom/bulker/jitsubase/utils"
	"github.com/jitsucom/bulker/sync-sidecar/db"

	"net/http"
)

type TaskManager struct {
	appbase.Service
	config    *Config
	jobRunner *JobRunner
	dbpool    *pgxpool.Pool
	closeCh   chan struct{}
}

func NewTaskManager(appContext *Context) (*TaskManager, error) {
	base := appbase.NewServiceBase("task-manager")

	t := &TaskManager{Service: base, config: appContext.config, jobRunner: appContext.jobRunner, dbpool: appContext.dbpool,
		closeCh: make(chan struct{})}
	safego.RunWithRestart(t.listenTaskStatus)
	// Retention sweep runs on its own goroutine so it can't back-pressure
	// status consumption when a global windowed delete takes a while —
	// jobRunner.sendStatus drops events after a 5s blocked send.
	safego.RunWithRestart(t.runRetentionSweeper)
	return t, nil
}

func (t *TaskManager) SpecHandler(c *gin.Context) {
	image := c.Query("package")
	version := c.Query("version")
	startedAt := time.Now().Round(time.Second)
	taskDescriptor := TaskDescriptor{
		TaskType:       "spec",
		Package:        image,
		PackageVersion: version,
		StartedAt:      startedAt.Format(time.RFC3339),
	}

	taskStatus := t.jobRunner.CreateJob(taskDescriptor, nil)
	if taskStatus.Status == StatusCreateFailed {
		c.JSON(http.StatusOK, gin.H{"ok": false, "error": taskStatus.Error})
		return
	}
	c.JSON(http.StatusOK, gin.H{"ok": true, "startedAt": startedAt.Unix()})
}

func (t *TaskManager) CheckHandler(c *gin.Context) {
	taskConfig := TaskConfiguration{}
	err := c.BindJSON(&taskConfig)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"ok": false, "error": err.Error()})
		return
	}
	taskDescriptor := TaskDescriptor{
		TaskType:       "check",
		Package:        c.Query("package"),
		PackageVersion: c.Query("version"),
		StorageKey:     c.Query("storageKey"),
		StartedAt:      time.Now().Format(time.RFC3339),
	}

	taskStatus := t.jobRunner.CreateJob(taskDescriptor, &taskConfig)
	if taskStatus.Status == StatusCreateFailed {
		c.JSON(http.StatusOK, gin.H{"ok": false, "error": taskStatus.Error})
		return
	}
	c.JSON(http.StatusOK, gin.H{"ok": true})
}

func (t *TaskManager) DiscoverHandler(c *gin.Context) {
	taskConfig := TaskConfiguration{}
	err := c.BindJSON(&taskConfig)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"ok": false, "error": err.Error()})
		return
	}
	taskDescriptor := TaskDescriptor{
		TaskType:       "discover",
		WorkspaceId:    c.Query("workspaceId"),
		SyncID:         c.Query("syncId"),
		TaskID:         c.Query("taskId"),
		Package:        c.Query("package"),
		PackageVersion: c.Query("version"),
		StorageKey:     c.Query("storageKey"),
		StartedAt:      time.Now().Format(time.RFC3339),
		ThenRun:        c.Query("thenRun"),
		FullSync:       c.Query("fullSync"),
		StartedBy:      c.Query("startedBy"),
	}

	taskStatus := t.jobRunner.CreateJob(taskDescriptor, &taskConfig)
	if taskStatus.Status == StatusCreateFailed {
		c.JSON(http.StatusOK, gin.H{"ok": false, "error": taskStatus.Error})
		return
	}
	c.JSON(http.StatusOK, gin.H{"ok": true})
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

func (t *TaskManager) ReadHandler(c *gin.Context) {
	syncID := c.Query("syncId")
	taskID := c.Query("taskId")
	pkg := c.Query("package")
	t.Infof("ReadHandler: syncId=%s taskId=%s package=%s fullSync=%s nodelay=%s startedBy=%s",
		syncID, taskID, pkg, c.Query("fullSync"), c.Query("nodelay"), c.Query("startedBy"))

	// Admission gate: fail-fast if a Lease is currently held for this sync —
	// either a cron-spawned Pod is running, or another manual run hasn't
	// released its lease yet. Avoids spawning a second Pod that would
	// promptly self-exit at the lease-acquire init container anyway.
	if held, err := IsSyncLeaseHeld(t.jobRunner.clientset, t.config.KubernetesNamespace, syncID); err != nil {
		// Fail open: don't block on a transient k8s API error. The Pod's
		// own lease-acquire init still enforces the invariant.
		t.Warnf("admission lease check failed for sync %s: %v (allowing run)", syncID, err)
	} else if held {
		t.Infof("ReadHandler: rejecting syncId=%s taskId=%s — lease already held", syncID, taskID)
		c.JSON(http.StatusConflict, gin.H{
			"ok":     false,
			"error":  "sync is already running (lease held)",
			"syncId": syncID,
		})
		return
	}

	taskConfig := TaskConfiguration{}
	err := jsonorder.NewDecoder(c.Request.Body).Decode(&taskConfig)
	defer c.Request.Body.Close()
	if err != nil {
		t.Warnf("ReadHandler: bad body for syncId=%s taskId=%s: %v", syncID, taskID, err)
		c.JSON(http.StatusBadRequest, gin.H{"ok": false, "error": err.Error()})
		return
	}
	if taskConfig.State == nil {
		taskConfig.State = map[string]any{}
	}
	taskDescriptor := TaskDescriptor{
		TaskType:        "read",
		Package:         pkg,
		PackageVersion:  c.Query("version"),
		SyncID:          syncID,
		TaskID:          taskID,
		Namespace:       c.Query("namespace"),
		TableNamePrefix: c.Query("tableNamePrefix"),
		ToSameCase:      c.Query("toSameCase"),
		AddMeta:         c.Query("addMeta"),
		Deduplicate:     c.Query("deduplicate"),
		FullSync:        c.Query("fullSync"),
		Debug:           c.Query("debug"),
		Nodelay:         c.Query("nodelay"),
		StartedBy:       c.Query("startedBy"),
		StartedAt:       time.Now().Format(time.RFC3339),
	}

	taskStatus := t.jobRunner.CreateJob(taskDescriptor, &taskConfig)
	if taskStatus.Status == StatusCreateFailed {
		t.Errorf("ReadHandler: CreateJob failed for syncId=%s taskId=%s: %s", syncID, taskID, taskStatus.Error)
		c.JSON(http.StatusOK, gin.H{"ok": false, "error": taskStatus.Error})
		return
	}
	t.Infof("ReadHandler: created pod for syncId=%s taskId=%s status=%s pod=%s",
		syncID, taskID, taskStatus.Status, taskStatus.PodName)
	c.JSON(http.StatusOK, gin.H{"ok": true})
}

//
//func (t *TaskManager) ScheduleHandler(c *gin.Context) {
//	taskConfig := TaskConfiguration{}
//	err := jsonorder.NewDecoder(c.Request.Body).Decode(&taskConfig)
//	defer c.Request.Body.Close()
//	if err != nil {
//		c.JSON(http.StatusBadRequest, gin.H{"ok": false, "error": err.Error()})
//		return
//	}
//	if taskConfig.State == nil {
//		taskConfig.State = map[string]any{}
//	}
//	taskDescriptor := TaskDescriptor{
//		TaskType:        "read",
//		Package:         c.Query("package"),
//		PackageVersion:  c.Query("version"),
//		SyncID:          c.Query("syncId"),
//		TaskID:          c.Query("taskId"),
//		TableNamePrefix: c.Query("tableNamePrefix"),
//		StartedBy:       c.Query("startedBy"),
//		StartedAt:       time.Now().Format(time.RFC3339),
//	}
//
//	taskStatus := t.jobRunner.CreateCronJob(taskDescriptor, &taskConfig)
//	if taskStatus.Status == StatusCreateFailed {
//		c.JSON(http.StatusOK, gin.H{"ok": false, "error": taskStatus.Description})
//		return
//	}
//	c.JSON(http.StatusOK, gin.H{"ok": true})
//}

func (t *TaskManager) runReadTask(st *TaskStatus) {
	if t.config.ConsoleURL == "" || t.config.ConsoleToken == "" {
		t.Errorf("ConsoleURL and ConsoleToken are required to initiate read task after ed")
		t.jobRunner.runningSyncs.Delete(st.SyncID)
		return
	}
	url := t.config.ConsoleURL + "/api/" + st.WorkspaceId + "/sources/run?syncId=" + st.SyncID + "&taskId=" + st.TaskID + "&skipRefresh=true&nodelay=true"
	t.Infof("Initiating read task %s for syncId %s: %s", st.TaskID, st.SyncID, url)
	req, _ := http.NewRequest("GET", url, nil)
	req.Header.Add("Authorization", "Bearer "+t.config.ConsoleToken)
	res, err := http.DefaultClient.Do(req)
	if err != nil {
		t.jobRunner.runningSyncs.Delete(st.SyncID)
		err = db.UpsertRunningTask(t.dbpool, st.SyncID, st.TaskID, st.Package, st.PackageVersion, st.StartedAtTime(), "FAILED", fmt.Sprintf("FAILED: Unable to initiate read task: %v", err), st.StartedBy)
		if err != nil {
			t.Errorf("Unable to update '%s' status: %v\n", st.TaskType, err)
		}
		return
	} else if res.StatusCode != http.StatusOK {
		t.jobRunner.runningSyncs.Delete(st.SyncID)
		err = db.UpsertRunningTask(t.dbpool, st.SyncID, st.TaskID, st.Package, st.PackageVersion, st.StartedAtTime(), "FAILED", fmt.Sprintf("FAILED: Unable to initiate read task: %s", res.Status), st.StartedBy)
		if err != nil {
			t.Errorf("Unable to update '%s' status: %v\n", st.TaskType, err)
		}
		return
	} else {
		t.Infof("Sync %s Read task %s initiated successfully", st.SyncID, st.TaskID)
	}
}

func (t *TaskManager) listenTaskStatus() {
	staleTicker := time.NewTicker(15 * time.Minute)
	defer staleTicker.Stop()
	for {
		select {
		case <-t.closeCh:
			return
		case <-staleTicker.C:
			err := db.CloseStaleTasks(t.dbpool, time.Now().Add(-time.Hour))
			if err != nil {
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
					if utils.IsTruish(st.ThenRun) {
						t.runReadTask(st)
					}
				} else if st.Status == StatusCreated {
					err = db.UpsertCatalogStatus(t.dbpool, st.Package, st.PackageVersion, st.StorageKey, st.StartedAtTime(), "RUNNING", "")
				} else if st.Status == StatusSuccess {
					if utils.IsTruish(st.ThenRun) {
						t.runReadTask(st)
					}
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
