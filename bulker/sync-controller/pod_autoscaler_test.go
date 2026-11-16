package main

import (
	"testing"

	v1 "k8s.io/api/core/v1"
)

func TestSyncPodAutoscalerProtection(t *testing.T) {
	cfg := reverseTestConfig()
	check := func(t *testing.T, pod v1.PodTemplateSpec) {
		t.Helper()
		if pod.Annotations["cluster-autoscaler.kubernetes.io/safe-to-evict"] != "false" {
			t.Fatal("sync pod can be evicted during the blue-green pre-drain wait")
		}
		if len(pod.Annotations) <= 1 {
			t.Fatal("task descriptor annotations were lost")
		}
	}
	for _, task := range []string{"spec", "check", "discover", "read"} {
		t.Run("manual/"+task, func(t *testing.T) {
			check(t, buildSyncPodTemplate(cfg, PodCtx{TaskType: task, TaskID: "manual-test", Inline: &InlinePayload{Package: "test", Version: "latest"}}, "config"))
		})
	}
	controller := &CronJobController{config: cfg}
	entry := &SyncEntry{ID: "connector", WorkspaceID: "workspace"}
	t.Run("scheduled/connector", func(t *testing.T) {
		check(t, controller.buildCronPodTemplate(entry))
	})
	entry = reverseFixture()
	controller.reverse = true
	t.Run("scheduled/reverse", func(t *testing.T) {
		check(t, controller.buildCronPodTemplate(entry))
	})
	t.Run("manual/reverse", func(t *testing.T) {
		check(t, buildReversePodTemplate(cfg, entry, "config", "manual-test"))
	})
}
