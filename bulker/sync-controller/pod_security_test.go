package main

import "testing"

func TestConnectorCannotInspectSidecarProcesses(t *testing.T) {
	for _, taskType := range []string{"spec", "check", "discover", "read"} {
		for _, cron := range []bool{false, true} {
			cfg := reverseTestConfig()
			pod := buildSyncPodTemplate(cfg, PodCtx{TaskType: taskType, Cron: cron, Inline: &InlinePayload{Package: "test", Version: "latest"}}, "config")
			if pod.Spec.ShareProcessNamespace != nil && *pod.Spec.ShareProcessNamespace {
				t.Fatalf("%s cron=%t exposes sidecar credentials via /proc", taskType, cron)
			}
		}
	}
}
