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
	kerrors "k8s.io/apimachinery/pkg/api/errors"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	"k8s.io/apimachinery/pkg/runtime"
	"k8s.io/apimachinery/pkg/runtime/schema"
	"k8s.io/client-go/kubernetes/fake"
	ktesting "k8s.io/client-go/testing"
)

func reverseFixture() *SyncEntry {
	return (&ReverseConfig{Version: 1, Kind: "reverse", ID: "sync", WorkspaceID: "workspace", FromID: "model", ToID: "destination", ConfigRevision: strings.Repeat("a", 64), UpdatedAt: time.Now().UTC(), Schedule: "0 * * * *", Timezone: "Etc/UTC", Model: json.RawMessage(`{"query":"SELECT id FROM users"}`), Warehouse: json.RawMessage(`{"password":"private"}`), Destination: json.RawMessage(`{"destinationType":"test"}`), Options: json.RawMessage(`{"mode":"mirror"}`)}).entry()
}
func reverseTestConfig() *Config {
	return &Config{KubernetesNamespace: "default", ReverseEnabled: true, ReverseRunnerImage: "retl:test", ReverseRuntimeSecret: "retl-runtime", PodsServiceAccount: "runner", JobActiveDeadlineSeconds: 3600, ContainerInitTimeoutSeconds: 180, TaskTimeoutHours: 1}
}

func TestPausedReverseEntryHasNoExtractionSchedule(t *testing.T) {
	config := reverseFixture().Reverse
	config.Options = json.RawMessage(`{"disabled":true,"mode":"mirror"}`)
	entry := config.entry()
	if !config.paused() || entry.Schedule != "" || entry.Reverse != config {
		t.Fatal("paused delivery must remain available without an extraction schedule")
	}
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
	runtimeKeys := map[string]bool{}
	for _, env := range pod.Spec.Containers[0].Env {
		if env.Name == "TASK_ID" && (env.ValueFrom == nil || env.ValueFrom.FieldRef.FieldPath != "metadata.name") {
			t.Fatal("cron task id is not per-fire")
		}
		if env.Name == "RETL_DATABASE_URL" && env.ValueFrom.SecretKeyRef.Name != "retl-runtime" {
			t.Fatal("runtime DB secret not referenced")
		}
		if env.ValueFrom != nil && env.ValueFrom.SecretKeyRef != nil {
			ref := env.ValueFrom.SecretKeyRef
			if ref.Optional == nil || !*ref.Optional {
				runtimeKeys[ref.Key] = true
			} else if ref.Name != "retl-runtime" {
				t.Fatal("optional artifact configuration must come from runtime Secret")
			}
		}
	}
	optionalKeys := map[string]bool{}
	for _, env := range pod.Spec.Containers[0].Env {
		if env.ValueFrom != nil && env.ValueFrom.SecretKeyRef != nil && env.ValueFrom.SecretKeyRef.Optional != nil && *env.ValueFrom.SecretKeyRef.Optional {
			optionalKeys[env.Name] = true
		}
	}
	if len(optionalKeys) != 7 || !optionalKeys["RETL_OBJECT_PREFIX"] || !optionalKeys["AWS_SECRET_ACCESS_KEY"] || !optionalKeys["GOOGLE_ADS_DEVELOPER_TOKEN"] {
		t.Fatal("optional runtime settings are missing")
	}
	if len(runtimeKeys) != 5 || !runtimeKeys["RETL_DATABASE_URL"] || !runtimeKeys["RETL_CONSOLE_URL"] || !runtimeKeys["RETL_CONSOLE_TOKEN"] || !runtimeKeys["RETL_OBJECT_STORE"] || !runtimeKeys["RETL_OBJECT_BUCKET"] {
		t.Fatal("runner must require DB, admission and object store Secret keys")
	}
	manual := buildReversePodTemplate(cfg, entry, "config", "manual-task")
	if manual.Annotations["TaskID"] != "manual-task" {
		t.Fatal("manual cancellation identity missing")
	}
}

func TestReverseDeveloperTokenUsesOptionalRuntimeSecret(t *testing.T) {
	for _, taskID := range []string{"", "manual-task", "refresh-task"} {
		t.Run(taskID, func(t *testing.T) {
			cfg := reverseTestConfig()
			cfg.GoogleAdsDeveloperToken = "controller-token-must-not-be-copied"
			pod := buildReversePodTemplate(cfg, reverseFixture(), "config", taskID)
			found := 0
			for _, env := range pod.Spec.Containers[0].Env {
				if env.Name != "GOOGLE_ADS_DEVELOPER_TOKEN" {
					continue
				}
				found++
				if env.Value != "" || env.ValueFrom == nil || env.ValueFrom.SecretKeyRef == nil {
					t.Fatal("developer token must use a Secret reference, not a literal")
				}
				ref := env.ValueFrom.SecretKeyRef
				if ref.Name != cfg.ReverseRuntimeSecret || ref.Key != env.Name || ref.Optional == nil || !*ref.Optional {
					t.Fatal("developer token must be optional and sourced from the runner runtime Secret")
				}
			}
			if found != 1 {
				t.Fatalf("expected one developer token projection, got %d", found)
			}
		})
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
	if j.cleanedUpPods.Contains(pod.Name) {
		t.Fatal("cleanup by name would hide a recreated refresh Pod")
	}
	if _, err := client.CoreV1().Pods("default").Get(context.Background(), pod.Name, metav1.GetOptions{}); err == nil {
		t.Fatal("running Pod was not deleted on retry")
	}
	replacement := pod.DeepCopy()
	replacement.UID = "new-uid"
	if _, err := client.CoreV1().Pods("default").Create(context.Background(), replacement, metav1.CreateOptions{}); err != nil {
		t.Fatal(err)
	}
	if j.cleanedUpPods.Contains(replacement.Name) {
		t.Fatal("replacement Pod would be skipped")
	}
}

func TestReverseRejectedPodSecretCleanup(t *testing.T) {
	pods := schema.GroupResource{Resource: "pods"}
	rejected := kerrors.NewForbidden(pods, "reverse-pod", errors.New("quota exceeded"))
	for _, tc := range []struct {
		name       string
		createErr  error
		podExists  bool
		getErr     error
		deleteErr  error
		missingUID bool
		wantDelete bool
	}{
		{name: "quota rejection", createErr: rejected, wantDelete: true},
		{name: "invalid spec", createErr: kerrors.NewInvalid(schema.GroupKind{Kind: "Pod"}, "reverse-pod", nil), wantDelete: true},
		{name: "timeout remains ambiguous", createErr: kerrors.NewTimeoutError("timeout", 1)},
		{name: "transport remains ambiguous", createErr: errors.New("connection reset")},
		{name: "server error remains ambiguous", createErr: kerrors.NewInternalError(errors.New("server error"))},
		{name: "already exists", createErr: kerrors.NewAlreadyExists(pods, "reverse-pod")},
		{name: "existing pod", createErr: rejected, podExists: true},
		{name: "absence check failed", createErr: rejected, getErr: errors.New("unavailable")},
		{name: "delete failed", createErr: rejected, deleteErr: errors.New("unavailable")},
		{name: "replacement secret protected", createErr: rejected, deleteErr: kerrors.NewConflict(schema.GroupResource{Resource: "secrets"}, "reverse-config", errors.New("UID precondition failed"))},
		{name: "missing UID", createErr: rejected, missingUID: true},
	} {
		t.Run(tc.name, func(t *testing.T) {
			secret := &v1.Secret{ObjectMeta: metav1.ObjectMeta{Name: "reverse-config", Namespace: "default", UID: "original-secret"}}
			client := fake.NewClientset(secret)
			if tc.missingUID {
				secret.UID = ""
			}
			if tc.podExists {
				_, err := client.CoreV1().Pods("default").Create(context.Background(), &v1.Pod{ObjectMeta: metav1.ObjectMeta{Name: "reverse-pod"}}, metav1.CreateOptions{})
				if err != nil {
					t.Fatal(err)
				}
			}
			if tc.getErr != nil {
				client.PrependReactor("get", "pods", func(ktesting.Action) (bool, runtime.Object, error) {
					return true, nil, tc.getErr
				})
			}
			client.PrependReactor("delete", "secrets", func(action ktesting.Action) (bool, runtime.Object, error) {
				deletion := action.(ktesting.DeleteAction)
				options := deletion.GetDeleteOptions()
				if deletion.GetName() != secret.Name || action.GetNamespace() != secret.Namespace || options.Preconditions == nil || options.Preconditions.UID == nil || *options.Preconditions.UID != secret.UID {
					t.Fatal("cleanup must target the exact created Secret UID")
				}
				return tc.deleteErr != nil, nil, tc.deleteErr
			})
			j := &JobRunner{clientset: client}
			if cleaned := j.cleanupRejectedReversePod("reverse-pod", secret, tc.createErr); cleaned != tc.wantDelete {
				t.Fatalf("cleanup returned %v, want %v", cleaned, tc.wantDelete)
			}
			_, err := client.CoreV1().Secrets("default").Get(context.Background(), secret.Name, metav1.GetOptions{})
			if tc.wantDelete && !kerrors.IsNotFound(err) {
				t.Fatalf("orphaned Secret retained: %v", err)
			} else if !tc.wantDelete && err != nil {
				t.Fatalf("credentials removed without safe cleanup: %v", err)
			}
		})
	}
}
