package main

import (
	"context"
	"encoding/json"
	"net/http"
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
		return StatusFailed, "Runner exited; delivery status must be committed by Node"
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
   ON CONFLICT(task_id) DO UPDATE SET status='CANCELLED',updated_at=clock_timestamp() WHERE source_task.sync_id=$1 AND source_task.status='RUNNING'`, syncID, taskID)
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
	_, err := t.dbpool.Exec(ctx, `UPDATE source_task SET status='FAILED',error='Reverse runner heartbeat expired; recovery required',updated_at=clock_timestamp()
  WHERE task_id IN (SELECT task_id FROM source_task WHERE package='jitsu/retl-runner' AND status='RUNNING' AND updated_at < clock_timestamp()-interval '2 minutes' LIMIT 100) AND status='RUNNING' AND updated_at < clock_timestamp()-interval '2 minutes'
  `)
	if err != nil {
		t.Errorf("reverse stale-task check failed")
		return
	}
	// The Pod watcher retries termination of terminal reverse tasks independently.
	// Never spend this DB context's remaining budget on Kubernetes requests.
}

func (j *JobRunner) endedReverseTasks(pods []v1.Pod) map[string]bool {
	ended := map[string]bool{}
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
		rows, err := j.dbpool.Query(ctx, `SELECT sync_id,task_id FROM source_task WHERE package='jitsu/retl-runner' AND status IN ('SUCCESS','FAILED','CANCELLED') AND task_id=ANY($1)`, ids[offset:end])
		if err != nil {
			cancel()
			continue
		}
		page := map[string]bool{}
		for rows.Next() {
			var syncID, taskID string
			if err = rows.Scan(&syncID, &taskID); err != nil {
				break
			}
			page[syncID+":"+taskID] = true
		}
		complete := err == nil && rows.Err() == nil
		rows.Close()
		cancel()
		if complete {
			for key := range page {
				ended[key] = true
			}
		}
	}
	return ended
}

// Called only by the watcher. A failed delete never suppresses the next retry.
func (j *JobRunner) cleanupReversePod(pod *v1.Pod) {
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	err := j.clientset.CoreV1().Pods(j.namespace).Delete(ctx, pod.Name, metav1.DeleteOptions{Preconditions: &metav1.Preconditions{UID: &pod.UID}})
	if err != nil && !kerrors.IsNotFound(err) {
		return
	}
	j.cleanedUpPods.Put(pod.Name)
	_ = j.clientset.CoreV1().Secrets(j.namespace).Delete(ctx, pod.Name+"-config", metav1.DeleteOptions{})
}
