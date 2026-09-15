package main

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"strings"
	"testing"
	"time"

	"github.com/jitsucom/bulker/jitsubase/appbase"
	"github.com/jitsucom/bulker/jitsubase/types"
	batchv1 "k8s.io/api/batch/v1"
	v1 "k8s.io/api/core/v1"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	"k8s.io/apimachinery/pkg/runtime"
	"k8s.io/client-go/kubernetes/fake"
	ktesting "k8s.io/client-go/testing"
)

func reverseFixture() *SyncEntry {
	return (&ReverseConfig{Version: 1, Kind: "reverse", ID: "sync", WorkspaceID: "workspace", FromID: "model", ToID: "destination", ConfigRevision: strings.Repeat("a", 64), UpdatedAt: time.Now().UTC(), Schedule: "0 * * * *", Timezone: "Etc/UTC", Model: json.RawMessage(`{"query":"SELECT id FROM users"}`), Warehouse: json.RawMessage(`{"password":"private"}`), Destination: json.RawMessage(`{"destinationType":"test"}`), Options: json.RawMessage(`{"mode":"mirror"}`)}).entry()
}
func reverseTestConfig() *Config {
	return &Config{KubernetesNamespace: "default", ReverseEnabled: true, ReverseRunnerImage: "retl:test", ReverseRuntimeSecret: "retl-runtime", PodsServiceAccount: "runner", JobActiveDeadlineSeconds: 3600, ContainerInitTimeoutSeconds: 180, TaskTimeoutHours: 1}
}

func TestReverseRepositoryRejectsPartialAndPreservesSnapshot(t *testing.T) {
	entry := reverseFixture()
	raw, _ := json.Marshal([]*ReverseConfig{entry.Reverse})
	repo := &SyncsRepositoryData{reverse: true}
	if err := repo.Init(bytes.NewReader(raw), nil); err != nil {
		t.Fatal(err)
	}
	previous := repo.GetData()
	for _, invalid := range []string{"null", "{}", "[", string(raw[:len(raw)-1]), string(raw) + " garbage", `[{"kind":"reverse"}]`} {
		if err := repo.Init(strings.NewReader(invalid), nil); err == nil {
			t.Fatalf("accepted invalid feed %q", invalid)
		}
		if repo.GetData() != previous {
			t.Fatal("failed feed replaced good snapshot")
		}
	}
	var cached bytes.Buffer
	if err := repo.Store(&cached); err != nil {
		t.Fatal(err)
	}
	restored := &SyncsRepositoryData{reverse: true}
	if err := restored.Init(&cached, nil); err != nil {
		t.Fatal(err)
	}
	if restored.GetData().BySyncID[entry.ID].Reverse.ConfigRevision != entry.Reverse.ConfigRevision {
		t.Fatal("cache lost reverse config")
	}
}
func TestReversePodContract(t *testing.T) {
	if reverseResourceName("sync") != "reverse-75c75efe327a8ef35a072f25117961f5" {
		t.Fatal("Node/Go name contract changed")
	}
	cfg, entry := reverseTestConfig(), reverseFixture()
	pod := buildReversePodTemplate(cfg, entry, "config", "")
	if len(pod.Spec.Containers) != 1 || len(pod.Spec.InitContainers) != 0 || pod.Spec.Containers[0].Name != "retl-runner" {
		t.Fatal("reverse jobs must use one Node container")
	}
	if pod.Labels[labelSyncKind] != "reverse" || pod.Annotations["TaskType"] != "reverse" {
		t.Fatal("missing kind annotations")
	}
	encoded, _ := json.Marshal(pod)
	if strings.Contains(string(encoded), "private") {
		t.Fatal("credentials leaked into pod")
	}
	for _, env := range pod.Spec.Containers[0].Env {
		if env.Name == "TASK_ID" && (env.ValueFrom == nil || env.ValueFrom.FieldRef.FieldPath != "metadata.name") {
			t.Fatal("cron task id is not per-fire")
		}
		if env.Name == "RETL_DATABASE_URL" && env.ValueFrom.SecretKeyRef.Name != "retl-runtime" {
			t.Fatal("runtime DB secret not referenced")
		}
	}
	manual := buildReversePodTemplate(cfg, entry, "config", "manual-task")
	if manual.Annotations["TaskID"] != "manual-task" {
		t.Fatal("manual cancellation identity missing")
	}
}

type testRepository struct {
	appbase.Repository[SyncsData]
	data *SyncsData
}

func (r testRepository) GetData() *SyncsData { return r.data }

func TestReconcileIsolatesReverseAndConnectorKinds(t *testing.T) {
	client := fake.NewClientset()
	cfg := reverseTestConfig()
	connector := &batchv1.CronJob{ObjectMeta: metav1.ObjectMeta{Name: "sync-connector", Namespace: "default", Labels: map[string]string{labelManagedBy: managedByValue, labelSyncID: "connector"}}}
	_, _ = client.BatchV1().CronJobs("default").Create(context.Background(), connector, metav1.CreateOptions{})
	entry := reverseFixture()
	data := &SyncsData{Syncs: []*SyncEntry{entry}, BySyncID: map[string]*SyncEntry{entry.ID: entry}}
	c := &CronJobController{Service: appbase.NewServiceBase("test"), config: cfg, clientset: client, reverse: true, repo: testRepository{data: data}}
	c.reconcile()
	reverse, err := client.BatchV1().CronJobs("default").Get(context.Background(), reverseResourceName(entry.ID), metav1.GetOptions{})
	if err != nil {
		t.Fatal(err)
	}
	if reverse.Spec.ConcurrencyPolicy != batchv1.ForbidConcurrent || *reverse.Spec.JobTemplate.Spec.BackoffLimit != 0 {
		t.Fatal("unsafe retry/concurrency policy")
	}
	if _, err := client.BatchV1().CronJobs("default").Get(context.Background(), connector.Name, metav1.GetOptions{}); err != nil {
		t.Fatal("reverse reconcile deleted connector")
	}
	c.reverse = false
	c.repo = testRepository{data: &SyncsData{}}
	c.reconcile()
	if _, err := client.BatchV1().CronJobs("default").Get(context.Background(), reverse.Name, metav1.GetOptions{}); err != nil {
		t.Fatal("connector reconcile deleted reverse")
	}
	c.reverse = true
	c.repo = testRepository{data: nil}
	c.reconcile()
	if _, err := client.BatchV1().CronJobs("default").Get(context.Background(), reverse.Name, metav1.GetOptions{}); err != nil {
		t.Fatal("nil feed deleted reverse")
	}
	c.repo = testRepository{data: &SyncsData{}}
	c.reconcile()
	if _, err := client.BatchV1().CronJobs("default").Get(context.Background(), reverse.Name, metav1.GetOptions{}); err == nil {
		t.Fatal("successful empty feed did not remove reverse")
	}
}
func TestReverseDriftIncludesRuntimeAndConfig(t *testing.T) {
	c := &CronJobController{config: reverseTestConfig(), reverse: true}
	entry := reverseFixture()
	initial := c.configHash(entry)
	c.config.ReverseRuntimeSecret = "rotated"
	if c.configHash(entry) == initial {
		t.Fatal("runtime Secret drift missed")
	}
	initial = c.configHash(entry)
	entry.Reverse.Warehouse = json.RawMessage(`{"password":"rotated"}`)
	if c.configHash(entry) == initial {
		t.Fatal("warehouse config drift missed")
	}
}
func TestReversePodExitNeverMeansDeliverySuccess(t *testing.T) {
	cfg := reverseTestConfig()
	for _, phase := range []v1.PodPhase{v1.PodSucceeded, v1.PodFailed, v1.PodUnknown} {
		status, _ := reversePodStatus(&v1.Pod{Status: v1.PodStatus{Phase: phase}}, cfg)
		if status != StatusFailed {
			t.Fatalf("%s inferred successful delivery", phase)
		}
	}
	pending := &v1.Pod{ObjectMeta: metav1.ObjectMeta{CreationTimestamp: metav1.NewTime(time.Now().Add(-10 * time.Minute))}, Status: v1.PodStatus{Phase: v1.PodPending}}
	if status, _ := reversePodStatus(pending, cfg); status != StatusInitTimeout {
		t.Fatal("unscheduled runner never times out")
	}
	running := &v1.Pod{ObjectMeta: metav1.ObjectMeta{CreationTimestamp: metav1.Now()}, Status: v1.PodStatus{Phase: v1.PodRunning}}
	if status, _ := reversePodStatus(running, cfg); status != StatusRunning {
		t.Fatal("live runner marked failed")
	}
}

func TestReverseTerminationRetriesTransientFailure(t *testing.T) {
	pod := &v1.Pod{ObjectMeta: metav1.ObjectMeta{Name: "reverse-pod", Namespace: "default", UID: "old-uid"}, Status: v1.PodStatus{Phase: v1.PodRunning}}
	client := fake.NewClientset(pod)
	failed := false
	client.PrependReactor("delete", "pods", func(action ktesting.Action) (bool, runtime.Object, error) {
		options := action.(ktesting.DeleteAction).GetDeleteOptions()
		if options.Preconditions == nil || *options.Preconditions.UID != pod.UID {
			t.Fatal("missing Pod UID precondition")
		}
		if !failed {
			failed = true
			return true, nil, errors.New("temporary Kubernetes outage")
		}
		return false, nil, nil
	})
	j := &JobRunner{clientset: client, namespace: "default", cleanedUpPods: types.NewSet[string]()}
	j.cleanupReversePod(pod)
	if j.cleanedUpPods.Contains(pod.Name) {
		t.Fatal("failed deletion suppressed future retries")
	}
	if _, err := client.CoreV1().Pods("default").Get(context.Background(), pod.Name, metav1.GetOptions{}); err != nil {
		t.Fatal("first deletion unexpectedly succeeded")
	}
	// Next watcher pass still observes Running with terminal task state.
	j.cleanupReversePod(pod)
	if !j.cleanedUpPods.Contains(pod.Name) {
		t.Fatal("successful retry not recorded")
	}
	if _, err := client.CoreV1().Pods("default").Get(context.Background(), pod.Name, metav1.GetOptions{}); err == nil {
		t.Fatal("running Pod was not deleted on retry")
	}
}
