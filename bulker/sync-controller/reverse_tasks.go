package main

import (
	"context"
	"encoding/json"
	"net/http"
	"strconv"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/jitsucom/bulker/jitsubase/uuid"
	"github.com/mitchellh/mapstructure"
	v1 "k8s.io/api/core/v1"
	kerrors "k8s.io/apimachinery/pkg/api/errors"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	"k8s.io/utils/ptr"
)

func reversePodStatus(pod *v1.Pod, config *Config) (Status, string) {
	if pod.Status.Phase == v1.PodSucceeded || pod.Status.Phase == v1.PodFailed {
		return StatusFailed, "Runner exited; task status must be committed by Node"
	}
	started := pod.CreationTimestamp.Time
	if pod.Status.StartTime != nil {
		started = pod.Status.StartTime.Time
	}
	if pod.Status.Phase == v1.PodPending {
		if time.Since(started) > time.Duration(config.ContainerInitTimeoutSeconds)*time.Second {
			return StatusInitTimeout, "Reverse runner did not start in time"
		}
		return StatusPending, ""
	}
	if pod.Status.Phase == v1.PodRunning {
		if time.Since(started) > time.Duration(config.TaskTimeoutHours)*time.Hour {
			return StatusTimeExceeded, "Reverse runner deadline exceeded"
		}
		return StatusRunning, ""
	}
	return StatusFailed, "Reverse runner pod state is unknown"
}

func (t *TaskManager) ReverseReadHandler(c *gin.Context) {
	if !t.config.ReverseEnabled || t.appContext.reverseRepo == nil {
		c.JSON(http.StatusServiceUnavailable, gin.H{"ok": false, "error": "Reverse runner is disabled"})
		return
	}
	syncID, workspaceID := c.Query("syncId"), c.Query("workspaceId")
	if !reverseID.MatchString(syncID) || workspaceID == "" {
		c.JSON(http.StatusBadRequest, gin.H{"ok": false, "error": "syncId and workspaceId required"})
		return
	}
	ctx, cancel := context.WithTimeout(c.Request.Context(), 30*time.Second)
	defer cancel()
	entry, err := WaitForSyncEntry(ctx, t.appContext.reverseRepo, syncID, parseUpdatedAtQuery(c))
	// Unlike legacy connector admission, do not proceed with a stale revision.
	if err != nil || entry == nil || entry.WorkspaceID != workspaceID || entry.Reverse == nil {
		c.JSON(http.StatusConflict, gin.H{"ok": false, "error": "Reverse configuration is unavailable or stale"})
		return
	}
	if taskID := c.Query("taskId"); taskID != "" {
		t.refreshReverseTask(c, ctx, entry, taskID)
		return
	}
	taskID := uuid.New()
	name := reverseResourceName(syncID + ":" + taskID)
	secretName := name + "-config"
	raw, err := json.Marshal(entry.Reverse)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"ok": false})
		return
	}
	client := t.jobRunner.clientset
	secret, err := client.CoreV1().Secrets(t.config.KubernetesNamespace).Create(ctx, &v1.Secret{ObjectMeta: metav1.ObjectMeta{Name: secretName, Namespace: t.config.KubernetesNamespace, Labels: map[string]string{labelManagedBy: managedByValue, labelSyncKind: "reverse", labelSyncID: syncID}}, Immutable: ptr.To(true), Data: map[string][]byte{"reverse.json": raw}}, metav1.CreateOptions{})
	if err != nil {
		c.JSON(http.StatusServiceUnavailable, gin.H{"ok": false, "error": "Failed to prepare reverse job"})
		return
	}
	template := buildReversePodTemplate(t.config, entry, secretName, taskID)
	template.Spec.ActiveDeadlineSeconds = ptr.To(int64(t.config.JobActiveDeadlineSeconds))
	pod, err := client.CoreV1().Pods(t.config.KubernetesNamespace).Create(ctx, &v1.Pod{ObjectMeta: metav1.ObjectMeta{Name: name, Namespace: t.config.KubernetesNamespace, Labels: template.Labels, Annotations: template.Annotations}, Spec: template.Spec}, metav1.CreateOptions{})
	if err != nil {
		if t.jobRunner.cleanupRejectedReversePod(name, secret, err) {
			c.JSON(http.StatusServiceUnavailable, gin.H{"ok": false, "error": "Reverse job creation rejected", "taskId": taskID})
			return
		}
		// Keep credentials when creation or cleanup is uncertain. A Pod may still
		// be starting; its eventual watcher cleanup also removes the Secret.
		c.JSON(http.StatusServiceUnavailable, gin.H{"ok": false, "error": "Reverse job creation uncertain", "taskId": taskID})
		return
	}
	secret.OwnerReferences = []metav1.OwnerReference{{APIVersion: "v1", Kind: "Pod", Name: pod.Name, UID: pod.UID}}
	_, _ = client.CoreV1().Secrets(t.config.KubernetesNamespace).Update(ctx, secret, metav1.UpdateOptions{})
	c.JSON(http.StatusOK, gin.H{"ok": true, "taskId": taskID, "podName": name})
}

// Explicit status check retries the saved run, never starts warehouse extraction.
func (t *TaskManager) refreshReverseTask(c *gin.Context, ctx context.Context, entry *SyncEntry, taskID string) {
	var attempt int
	err := t.dbpool.QueryRow(ctx, `UPDATE source_task t SET status='PENDING',
      description='Status refresh requested',updated_at=clock_timestamp(),
      metrics=jsonb_set(t.metrics,'{reverseRecovery}',t.metrics->'reverseRecovery' || jsonb_build_object(
        'previousStatus',COALESCE(t.metrics->'reverseRecovery'->>'previousStatus',t.status),'suspended',false,
        'attempt',COALESCE((t.metrics->'reverseRecovery'->>'attempt')::int,0)+1,
        'nextCheckAt',to_char(clock_timestamp() AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
        'deadline',to_char((clock_timestamp()+interval '24 hours') AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')))
      FROM reverse_sync_control c WHERE t.sync_id=$1 AND t.task_id=$2 AND t.package='jitsu/retl-runner'
      AND t.status IN ('PENDING','WAITING','FAILED') AND COALESCE((t.metrics->'reverseWorker'->>'active')::boolean,false)=false
      AND COALESCE((t.metrics->'reverseRecovery'->>'attempt')::int,0)<2147483647
      AND t.started_by->>'workspaceId'=$3 AND c.workspace_id=$3 AND c.sync_id=t.sync_id
      AND c.run_id=t.metrics->'reverseRecovery'->>'runId' AND c.revision=$4
      AND c.revision=t.metrics->'reverseRecovery'->>'revision' AND c.phase NOT IN ('complete','aborted')
      RETURNING (t.metrics->'reverseRecovery'->>'attempt')::int`, entry.ID, taskID, entry.WorkspaceID, entry.Reverse.ConfigRevision).Scan(&attempt)
	if err != nil {
		c.JSON(http.StatusConflict, gin.H{"ok": false, "error": "Saved run is unavailable or a status check is already active"})
		return
	}
	if err = t.launchReverseRecovery(ctx, entry, taskID, attempt); err != nil {
		_ = t.recordReverseRefreshFailure(ctx, entry.ID, taskID,
			reverseResourceName(entry.ID+":refresh:"+taskID+":"+strconv.Itoa(attempt)),
			"Status refresh could not start; saved delivery retained.", false)
		c.JSON(http.StatusServiceUnavailable, gin.H{"ok": false, "error": "Status refresh queued; automatic scheduling will retry", "taskId": taskID})
		return
	}
	c.JSON(http.StatusOK, gin.H{"ok": true, "taskId": taskID})
}

// cleanupRejectedReversePod only removes credentials after a definite API
// rejection and an independent absence check. A timeout/transport failure can
// still commit the Pod after a GET returns NotFound, so it must retain the Secret.
func (j *JobRunner) cleanupRejectedReversePod(name string, secret *v1.Secret, createErr error) bool {
	if !(kerrors.IsInvalid(createErr) || kerrors.IsForbidden(createErr) || kerrors.IsUnauthorized(createErr) || kerrors.IsBadRequest(createErr) || kerrors.IsNotFound(createErr)) {
		return false
	}
	if secret.UID == "" {
		return false
	}
	// The request context may already be cancelled; cleanup has its own budget.
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	if _, err := j.clientset.CoreV1().Pods(secret.Namespace).Get(ctx, name, metav1.GetOptions{}); !kerrors.IsNotFound(err) {
		return false
	}
	err := j.clientset.CoreV1().Secrets(secret.Namespace).Delete(ctx, secret.Name, metav1.DeleteOptions{Preconditions: &metav1.Preconditions{UID: &secret.UID}})
	return err == nil || kerrors.IsNotFound(err)
}

func (t *TaskManager) ReverseCancelHandler(c *gin.Context) {
	syncID, taskID, workspaceID := c.Query("syncId"), c.Query("taskId"), c.Query("workspaceId")
	if !reverseID.MatchString(syncID) || taskID == "" || workspaceID == "" {
		c.JSON(http.StatusBadRequest, gin.H{"ok": false, "error": "Scoped syncId, taskId and workspaceId required"})
		return
	}
	// WAITING has no live Pod. Cancel RUNNING here too, so a concurrent
	// RUNNING -> WAITING transition cannot slip between this write and Pod lookup.
	// The workspace binding remains valid after the entity/rollout is disabled.
	ctx, cancel := context.WithTimeout(c.Request.Context(), 5*time.Second)
	_, err := t.dbpool.Exec(ctx, `UPDATE source_task SET status='CANCELLED',updated_at=clock_timestamp(),
 description='Automatic recovery cancelled; unresolved delivery retained'
 WHERE sync_id=$1 AND task_id=$2 AND package='jitsu/retl-runner' AND status IN ('RUNNING','WAITING','PENDING')
 AND started_by->>'workspaceId'=$3`, syncID, taskID, workspaceID)
	cancel()
	if err != nil {
		c.JSON(http.StatusServiceUnavailable, gin.H{"ok": false})
		return
	}
	// Cancellation remains available after the rollout flag is disabled or the
	// entity is removed from the feed. Scope the Pod, not the current desired set.
	selector := labelManagedBy + "=" + managedByValue + "," + labelSyncKind + "=reverse," + labelSyncID + "=" + syncID
	pods, err := t.jobRunner.clientset.CoreV1().Pods(t.config.KubernetesNamespace).List(c.Request.Context(), metav1.ListOptions{LabelSelector: selector})
	if err != nil {
		c.JSON(http.StatusServiceUnavailable, gin.H{"ok": false})
		return
	}
	for i := range pods.Items {
		pod := &pods.Items[i]
		if pod.Labels[labelWorkspaceID] != workspaceID || !podMatchesTask(pod, taskID) {
			continue
		}
		// Insert CANCELLED as well when cancellation beats Node task creation.
		// The runner's INSERT DO NOTHING gate then prohibits starting this task.
		ctx, cancel := context.WithTimeout(c.Request.Context(), 5*time.Second)
		_, err = t.dbpool.Exec(ctx, `INSERT INTO source_task(sync_id,task_id,package,version,status) VALUES($1,$2,'jitsu/retl-runner','1','CANCELLED')
   ON CONFLICT(task_id) DO UPDATE SET status='CANCELLED',updated_at=clock_timestamp() WHERE source_task.sync_id=$1 AND source_task.status IN ('RUNNING','WAITING','PENDING')`, syncID, taskID)
		cancel()
		if err != nil {
			c.JSON(http.StatusServiceUnavailable, gin.H{"ok": false})
			return
		}
		t.jobRunner.TerminatePod(pod.Name)
	}
	c.JSON(http.StatusOK, gin.H{"ok": true})
}

func (t *TaskManager) closeStaleReverseTasks() {
	// Controller must NOT update this heartbeat based on PodRunning. A hung Node
	// process is precisely what this independent check is intended to detect.
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	_, err := t.dbpool.Exec(ctx, `UPDATE source_task SET status='FAILED',error='Reverse runner heartbeat expired; recovery required',updated_at=clock_timestamp(),
  metrics=jsonb_set(COALESCE(metrics,'{}'::jsonb),'{reverseWorker,active}','false')
  WHERE task_id IN (SELECT task_id FROM source_task WHERE package='jitsu/retl-runner' AND
    status='RUNNING'
    AND updated_at < clock_timestamp()-interval '2 minutes' LIMIT 100)
    AND status='RUNNING'
    AND updated_at < clock_timestamp()-interval '2 minutes'
  `)
	if err != nil {
		t.Errorf("reverse stale-task check failed")
		return
	}
	rows, err := t.dbpool.Query(ctx, `SELECT sync_id,task_id,metrics->'reverseWorker'->>'id' FROM source_task
 WHERE package='jitsu/retl-runner' AND status='PENDING' AND (metrics->'reverseWorker'->>'active')::boolean
 AND updated_at < clock_timestamp()-interval '2 minutes' LIMIT 100`)
	if err != nil {
		t.Errorf("reverse stale-refresh check failed")
		return
	}
	type staleWorker struct{ syncID, taskID, workerID string }
	var stale []staleWorker
	for rows.Next() {
		var worker staleWorker
		if err = rows.Scan(&worker.syncID, &worker.taskID, &worker.workerID); err != nil {
			break
		}
		stale = append(stale, worker)
	}
	complete := err == nil && rows.Err() == nil
	rows.Close()
	if !complete {
		return
	}
	for _, worker := range stale {
		if err := t.recordReverseRefreshFailure(ctx, worker.syncID, worker.taskID, worker.workerID,
			"Status refresh worker heartbeat expired; saved delivery retained.", true, time.Now().Add(-2*time.Minute)); err != nil {
			t.Errorf("reverse stale-refresh recording failed")
		}
	}
	// The Pod watcher retries termination of terminal reverse tasks independently.
	// Never spend this DB context's remaining budget on Kubernetes requests.
}

func (j *JobRunner) endedReverseTasks(pods []v1.Pod) map[string]bool {
	ended := map[string]bool{}
	type state struct {
		status, worker, attempt string
		active                  bool
	}
	states := map[string]state{}
	var ids []string
	for _, pod := range pods {
		if pod.Labels[labelSyncKind] != "reverse" {
			continue
		}
		var td TaskDescriptor
		_ = mapstructure.Decode(pod.Annotations, &td)
		if td.TaskID == "" {
			td.TaskID = pod.Name
		}
		ids = append(ids, td.TaskID)
	}
	for offset := 0; offset < len(ids); offset += 1000 {
		end := offset + 1000
		if end > len(ids) {
			end = len(ids)
		}
		ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
		rows, err := j.dbpool.Query(ctx, `SELECT sync_id,task_id,status,
      COALESCE(metrics->'reverseWorker'->>'id',''),COALESCE((metrics->'reverseWorker'->>'active')::boolean,false),
      COALESCE(metrics->'reverseRecovery'->>'attempt','0')
      FROM source_task WHERE package='jitsu/retl-runner' AND task_id=ANY($1)`, ids[offset:end])
		if err != nil {
			cancel()
			continue
		}
		page := map[string]state{}
		for rows.Next() {
			var syncID, taskID string
			var s state
			if err = rows.Scan(&syncID, &taskID, &s.status, &s.worker, &s.active, &s.attempt); err != nil {
				break
			}
			page[syncID+":"+taskID] = s
		}
		complete := err == nil && rows.Err() == nil
		rows.Close()
		cancel()
		if complete {
			for key, s := range page {
				states[key] = s
			}
		}
	}
	for _, pod := range pods {
		if pod.Labels[labelSyncKind] != "reverse" {
			continue
		}
		var td TaskDescriptor
		_ = mapstructure.Decode(pod.Annotations, &td)
		if td.TaskID == "" {
			td.TaskID = pod.Name
		}
		s, ok := states[td.SyncID+":"+td.TaskID]
		if !ok {
			continue
		}
		switch s.status {
		case "COMPLETE", "SUCCESS", "FAILED", "CANCELLED", "RESUMED":
			ended[pod.Name] = true
		case "PENDING", "WAITING":
			// A queued refresh shares the task ID but is not the worker that ended.
			attempt, refresh := pod.Annotations["ReverseRefreshAttempt"]
			ended[pod.Name] = (s.worker == pod.Name && !s.active) ||
				(s.worker != pod.Name && (s.active || !refresh || attempt != s.attempt))
		case "RUNNING":
			ended[pod.Name] = s.worker != "" && s.worker != pod.Name
		}
	}
	return ended
}

// Pod identity is distinct from logical task identity. A late failure notification
// must never fail another worker currently refreshing the same task.
func (t *TaskManager) failReverseWorker(st *TaskStatus) error {
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	var started map[string]any
	_ = json.Unmarshal([]byte(st.StartedBy), &started)
	if started["trigger"] == "recovery" {
		return t.recordReverseRefreshFailure(ctx, st.SyncID, st.TaskID, st.PodName,
			"Status refresh worker stopped before completing the check; saved delivery retained.", true)
	}
	_, err := t.dbpool.Exec(ctx, `INSERT INTO source_task(sync_id,task_id,package,version,status,started_by,error)
      VALUES($1,$2,'jitsu/retl-runner','1','FAILED',$3,'Reverse runner stopped before completing submission')
      ON CONFLICT(task_id) DO UPDATE SET status='FAILED',error=EXCLUDED.error,updated_at=clock_timestamp()
      WHERE source_task.sync_id=$1 AND source_task.status='RUNNING'
      AND (source_task.metrics->'reverseWorker'->>'id'=$4 OR source_task.metrics->'reverseWorker' IS NULL)`,
		st.SyncID, st.TaskID, st.StartedBy, st.PodName)
	return err
}

// Called only by the watcher. A failed delete never suppresses the next retry.
func (j *JobRunner) cleanupReversePod(pod *v1.Pod) {
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	err := j.clientset.CoreV1().Pods(j.namespace).Delete(ctx, pod.Name, metav1.DeleteOptions{Preconditions: &metav1.Preconditions{UID: &pod.UID}})
	if err != nil && !kerrors.IsNotFound(err) {
		return
	}
	// Reverse refresh names are reused after pre-start/lease-contention failures.
	// Never cache cleanup by name: a replacement Pod has a new UID and must be observed.
	_ = j.clientset.CoreV1().Secrets(j.namespace).Delete(ctx, pod.Name+"-config", metav1.DeleteOptions{})
}
