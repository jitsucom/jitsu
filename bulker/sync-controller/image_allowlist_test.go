package main

import (
	"context"
	"github.com/jitsucom/bulker/jitsubase/appbase"
	"k8s.io/apimachinery/pkg/api/errors"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	"k8s.io/client-go/kubernetes/fake"
	"testing"
)

func TestSourceImageAllowed(t *testing.T) {
	cases := []struct {
		prefixes string
		pkg      string
		want     bool
	}{
		{"", "anything/at-all", true},
		{"   ", "anything/at-all", true},
		{"airbyte/,jitsucom/", "airbyte/source-github", true},
		{"airbyte/, jitsucom/", "jitsucom/source-x", true},
		{"airbyte/,jitsucom/", "evil.example/airbyte/source-github", false},
		{"airbyte/,jitsucom/", "airbytefake/source-github", false},
		{"airbyte/,jitsucom/", "customer/image", false},
		{",,", "customer/image", false},
	}
	for _, tc := range cases {
		cfg := &Config{SyncAllowedImagePrefixes: tc.prefixes}
		if got := cfg.sourceImageAllowed(tc.pkg); got != tc.want {
			t.Errorf("prefixes %q, image %q: got %v, want %v", tc.prefixes, tc.pkg, got, tc.want)
		}
	}
}

func TestRejectedManualImageCreatesNoResources(t *testing.T) {
	client := fake.NewClientset()
	cfg := reverseTestConfig()
	cfg.SyncAllowedImagePrefixes = "airbyte/,jitsucom/"
	runner := &JobRunner{Service: appbase.NewServiceBase("test"), config: cfg, namespace: "default", clientset: client, taskStatusCh: make(chan *TaskStatus, 1)}
	for _, task := range []string{"spec", "check", "discover", "read"} {
		status := runner.CreatePod(PodCtx{TaskType: task, Inline: &InlinePayload{Package: "untrusted/source", Version: "1"}})
		if status.Status != StatusCreateFailed {
			t.Fatalf("%s was accepted", task)
		}
		<-runner.taskStatusCh
	}
	if len(client.Actions()) != 0 {
		t.Fatal("rejected image created a pod or secret")
	}
}

func TestReconcileRemovesDisallowedScheduleAndRestoresAllowed(t *testing.T) {
	client := fake.NewClientset()
	cfg := reverseTestConfig()
	entry := &SyncEntry{ID: "canary", Schedule: "0 * * * *", Timezone: "Etc/UTC", Source: SyncSourceConfig{Package: "customer/source", Version: "1"}}
	ctl := &CronJobController{Service: appbase.NewServiceBase("test"), config: cfg, clientset: client, repo: testRepository{data: &SyncsData{Syncs: []*SyncEntry{entry}}}}
	ctl.reconcile()
	if _, err := client.BatchV1().CronJobs("default").Get(context.Background(), cronJobName(entry.ID), metav1.GetOptions{}); err != nil {
		t.Fatal(err)
	}
	cfg.SyncAllowedImagePrefixes = "airbyte/,jitsucom/"
	ctl.reconcile()
	if _, err := client.BatchV1().CronJobs("default").Get(context.Background(), cronJobName(entry.ID), metav1.GetOptions{}); !errors.IsNotFound(err) {
		t.Fatalf("disallowed schedule remains: %v", err)
	}
	entry.Source.Package = "airbyte/source-test"
	ctl.reconcile()
	before, err := client.BatchV1().CronJobs("default").Get(context.Background(), cronJobName(entry.ID), metav1.GetOptions{})
	if err != nil {
		t.Fatal(err)
	}
	cfg.SyncFastShutdownIDs = "canary"
	ctl.reconcile()
	after, err := client.BatchV1().CronJobs("default").Get(context.Background(), cronJobName(entry.ID), metav1.GetOptions{})
	if err != nil {
		t.Fatal(err)
	}
	if before.Annotations[annotationConfigHash] == after.Annotations[annotationConfigHash] {
		t.Fatal("canary supervision did not update existing CronJob")
	}
	if after.Spec.JobTemplate.Spec.Template.Spec.ShareProcessNamespace == nil || *after.Spec.JobTemplate.Spec.Template.Spec.ShareProcessNamespace {
		t.Fatal("canary lost isolation")
	}
}
