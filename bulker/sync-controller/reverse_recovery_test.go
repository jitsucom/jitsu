package main

import (
	"context"
	"encoding/json"
	"testing"

	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	"k8s.io/client-go/kubernetes/fake"
)

func TestReverseRecoveryPodIsIndependentAndIdempotent(t *testing.T) {
	client := fake.NewClientset()
	tm := &TaskManager{config: reverseTestConfig(), jobRunner: &JobRunner{clientset: client}}
	entry := reverseFixture()
	entry.Schedule = "" // Even a manually triggered sync gets recovery checks.
	ctx := context.Background()
	for range 2 {
		if err := tm.launchReverseRecovery(ctx, entry, "waiting-task"); err != nil {
			t.Fatal(err)
		}
	}
	pods, _ := client.CoreV1().Pods("default").List(ctx, metav1.ListOptions{})
	secrets, _ := client.CoreV1().Secrets("default").List(ctx, metav1.ListOptions{})
	crons, _ := client.BatchV1().CronJobs("default").List(ctx, metav1.ListOptions{})
	if len(pods.Items) != 1 || len(secrets.Items) != 1 || len(crons.Items) != 0 {
		t.Fatal("expected one recovery Pod/Secret and no model CronJob")
	}
	pod := pods.Items[0]
	var started map[string]string
	if err := json.Unmarshal([]byte(pod.Annotations["StartedBy"]), &started); err != nil {
		t.Fatal(err)
	}
	if started["trigger"] != "recovery" || started["recoveryOf"] != "waiting-task" || started["workspaceId"] != entry.WorkspaceID {
		t.Fatalf("incorrect recovery binding: %v", started)
	}
	env := map[string]string{}
	for _, variable := range pod.Spec.Containers[0].Env {
		env[variable.Name] = variable.Value
	}
	if env["RETL_TRIGGER"] != "recovery" || env["RETL_RECOVERY_OF"] != "waiting-task" || env["TASK_ID"] != pod.Name {
		t.Fatal("missing Node recovery contract")
	}
	if pod.Spec.ActiveDeadlineSeconds == nil || *pod.Spec.ActiveDeadlineSeconds != int64(tm.config.JobActiveDeadlineSeconds) {
		t.Fatal("recovery Pod needs the normal active deadline")
	}
	if err := tm.launchReverseRecovery(ctx, entry, "next-waiting-task"); err != nil {
		t.Fatal(err)
	}
	pods, _ = client.CoreV1().Pods("default").List(ctx, metav1.ListOptions{})
	if len(pods.Items) != 2 {
		t.Fatal("next parent should create a distinct task")
	}
}

func TestReverseRecoveryRejectsChangedSecret(t *testing.T) {
	client := fake.NewClientset()
	tm := &TaskManager{config: reverseTestConfig(), jobRunner: &JobRunner{clientset: client}}
	entry := reverseFixture()
	ctx := context.Background()
	if err := tm.launchReverseRecovery(ctx, entry, "parent"); err != nil {
		t.Fatal(err)
	}
	entry.Reverse.ConfigRevision = "different-revision"
	if err := tm.launchReverseRecovery(ctx, entry, "parent"); err == nil {
		t.Fatal("must not reuse a Secret bound to different delivery config")
	}
}

func TestReverseRecoveryEntryScope(t *testing.T) {
	entry := reverseFixture()
	task := reverseRecoveryTask{SyncID: entry.ID, WorkspaceID: entry.WorkspaceID, Revision: entry.Reverse.ConfigRevision}
	if !recoveryEntryMatches(entry, task) || recoveryEntryMatches(nil, task) {
		t.Fatal("incorrect current/removed entry handling")
	}
	for _, field := range []string{"sync", "workspace", "revision"} {
		changed := task
		switch field {
		case "sync":
			changed.SyncID = "other"
		case "workspace":
			changed.WorkspaceID = "other"
		case "revision":
			changed.Revision = "other"
		}
		if recoveryEntryMatches(entry, changed) {
			t.Fatalf("accepted changed %s", field)
		}
	}
}
