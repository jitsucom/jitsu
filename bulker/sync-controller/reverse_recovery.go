package main

import (
	"context"
	"encoding/json"
	"fmt"
	"strconv"
	"time"

	v1 "k8s.io/api/core/v1"
	kerrors "k8s.io/apimachinery/pkg/api/errors"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	"k8s.io/utils/ptr"
)

// WAITING ends a worker attempt, not the logical delivery. This loop is
// independent of model CronJobs, including for manual-only syncs. No provider
// calls or checkpoints belong in syncctl.
func (t *TaskManager) runReverseRecoveryScheduler() {
	ticker := time.NewTicker(30 * time.Second)
	defer ticker.Stop()
	for {
		select {
		case <-t.closeCh:
			return
		case <-ticker.C:
			t.scheduleReverseRecovery()
		}
	}
}

type reverseRecoveryTask struct {
	SyncID, TaskID, WorkspaceID, Revision string
	Attempt                               int
}

func (t *TaskManager) scheduleReverseRecovery() {
	if !t.config.ReverseEnabled || t.appContext.reverseRepo == nil {
		return
	}
	data := t.appContext.reverseRepo.GetData()
	if data == nil {
		return
	}
	var ids, workspaces, revisions []string
	for _, entry := range data.Syncs {
		if entry.Reverse != nil {
			ids = append(ids, entry.ID)
			workspaces = append(workspaces, entry.WorkspaceID)
			revisions = append(revisions, entry.Reverse.ConfigRevision)
		}
	}
	if len(ids) == 0 {
		return
	}
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	rows, err := t.dbpool.Query(ctx, `SELECT t.sync_id,t.task_id,c.workspace_id,c.revision,COALESCE((t.metrics->'reverseRecovery'->>'attempt')::int,0)
 FROM source_task t JOIN reverse_sync_control c ON c.sync_id=t.sync_id
 JOIN unnest($1::text[],$2::text[],$3::text[]) desired(id,workspace,revision)
 ON desired.id=c.sync_id AND desired.workspace=c.workspace_id AND desired.revision=c.revision
 WHERE t.package='jitsu/retl-runner' AND t.status IN ('PENDING','WAITING')
 AND COALESCE((t.metrics->'reverseWorker'->>'active')::boolean,false)=false
 AND t.started_by->>'workspaceId'=c.workspace_id
 AND t.metrics->'reverseRecovery'->>'runId'=c.run_id
 AND t.metrics->'reverseRecovery'->>'revision'=c.revision
 AND c.phase NOT IN ('complete','aborted')
 AND (t.metrics->'reverseRecovery'->>'nextCheckAt')::timestamptz<=clock_timestamp()
 ORDER BY t.metrics->'reverseRecovery'->>'nextCheckAt' LIMIT 100`, ids, workspaces, revisions)
	if err != nil {
		cancel()
		t.Errorf("reverse recovery schedule read failed")
		return
	}
	var pending []reverseRecoveryTask
	for rows.Next() {
		var task reverseRecoveryTask
		if err = rows.Scan(&task.SyncID, &task.TaskID, &task.WorkspaceID, &task.Revision, &task.Attempt); err != nil {
			break
		}
		pending = append(pending, task)
	}
	complete := err == nil && rows.Err() == nil
	rows.Close()
	cancel()
	if !complete {
		t.Errorf("reverse recovery schedule read failed")
		return
	}
	for _, task := range pending {
		select {
		case <-t.closeCh:
			return
		default:
		}
		entry := data.BySyncID[task.SyncID]
		if !recoveryEntryMatches(entry, task) {
			continue
		}
		ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
		err := t.launchReverseRecovery(ctx, entry, task.TaskID, task.Attempt)
		cancel()
		if err != nil {
			t.Errorf("reverse recovery launch failed for sync %s", task.SyncID)
		}
	}
}

func recoveryEntryMatches(entry *SyncEntry, task reverseRecoveryTask) bool {
	return entry != nil && entry.Reverse != nil && entry.ID == task.SyncID &&
		entry.WorkspaceID == task.WorkspaceID && entry.Reverse.ConfigRevision == task.Revision
}

func (t *TaskManager) launchReverseRecovery(ctx context.Context, entry *SyncEntry, parentTaskID string, attempt int) error {
	// Deterministic identity makes repeated scans/controller replicas safe even
	// after an uncertain Create response. A new parent means a new check attempt.
	name := reverseResourceName(entry.ID + ":refresh:" + parentTaskID + ":" + strconv.Itoa(attempt))
	secretName := name + "-config"
	raw, err := json.Marshal(entry.Reverse)
	if err != nil {
		return err
	}
	client := t.jobRunner.clientset
	secret, err := client.CoreV1().Secrets(t.config.KubernetesNamespace).Create(ctx, &v1.Secret{
		ObjectMeta: metav1.ObjectMeta{Name: secretName, Namespace: t.config.KubernetesNamespace,
			Labels: map[string]string{labelManagedBy: managedByValue, labelSyncKind: "reverse", labelSyncID: entry.ID, labelWorkspaceID: entry.WorkspaceID}},
		Immutable: ptr.To(true), Data: map[string][]byte{"reverse.json": raw},
	}, metav1.CreateOptions{})
	if kerrors.IsAlreadyExists(err) {
		secret, err = client.CoreV1().Secrets(t.config.KubernetesNamespace).Get(ctx, secretName, metav1.GetOptions{})
		if err == nil {
			var saved ReverseConfig
			if json.Unmarshal(secret.Data["reverse.json"], &saved) != nil || saved.ID != entry.ID || saved.WorkspaceID != entry.WorkspaceID || saved.ConfigRevision != entry.Reverse.ConfigRevision {
				return fmt.Errorf("recovery configuration does not match")
			}
		}
	}
	if err != nil {
		return err
	}
	template := buildReversePodTemplate(t.config, entry, secretName, parentTaskID)
	template.Annotations["ReverseRefreshAttempt"] = strconv.Itoa(attempt)
	template.Spec.ActiveDeadlineSeconds = ptr.To(int64(t.config.JobActiveDeadlineSeconds))
	for i := range template.Spec.Containers[0].Env {
		if template.Spec.Containers[0].Env[i].Name == "RETL_TRIGGER" {
			template.Spec.Containers[0].Env[i].Value = "recovery"
		}
	}
	template.Spec.Containers[0].Env = append(template.Spec.Containers[0].Env, v1.EnvVar{Name: "RETL_RECOVERY_OF", Value: parentTaskID})
	template.Spec.Containers[0].Env = append(template.Spec.Containers[0].Env, v1.EnvVar{Name: "RETL_REFRESH_ATTEMPT", Value: strconv.Itoa(attempt)})
	startedBy, _ := json.Marshal(map[string]string{"trigger": "recovery", "kind": "reverse", "workspaceId": entry.WorkspaceID, "recoveryOf": parentTaskID})
	template.Annotations["StartedBy"] = string(startedBy)
	pod, err := client.CoreV1().Pods(t.config.KubernetesNamespace).Create(ctx, &v1.Pod{
		ObjectMeta: metav1.ObjectMeta{Name: name, Namespace: t.config.KubernetesNamespace, Labels: template.Labels, Annotations: template.Annotations}, Spec: template.Spec,
	}, metav1.CreateOptions{})
	if kerrors.IsAlreadyExists(err) {
		return nil
	}
	if err != nil {
		t.jobRunner.cleanupRejectedReversePod(name, secret, err)
		return err
	}
	secret.OwnerReferences = []metav1.OwnerReference{{APIVersion: "v1", Kind: "Pod", Name: pod.Name, UID: pod.UID}}
	_, err = client.CoreV1().Secrets(t.config.KubernetesNamespace).Update(ctx, secret, metav1.UpdateOptions{})
	return err
}
