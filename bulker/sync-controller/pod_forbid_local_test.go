package main

import (
	"testing"

	v1 "k8s.io/api/core/v1"
)

// A connector sync can write to a webhook destination whose URL the customer typed in. The sidecar sends those
// requests, so its container has to run the outbound HTTP client with the local-address guard switched on
// (FETCH_FORBID_LOCAL, read by bulkerlib/implementations/api_based/guarded_http.go). Without it a sync pod can be
// pointed at the cluster's own network: in-cluster services, the node and the cloud metadata address (JITSU-258).
func TestSidecarForbidsLocalOutboundAddresses(t *testing.T) {
	for _, taskType := range []string{"spec", "check", "discover", "read"} {
		for _, cron := range []bool{false, true} {
			cfg := reverseTestConfig()
			pod := buildSyncPodTemplate(cfg, PodCtx{TaskType: taskType, Cron: cron, Inline: &InlinePayload{Package: "test", Version: "latest"}}, "config")

			var sidecar *v1.Container
			for i := range pod.Spec.Containers {
				if pod.Spec.Containers[i].Name == "sidecar" {
					sidecar = &pod.Spec.Containers[i]
				}
			}
			if sidecar == nil {
				t.Fatalf("%s cron=%t: pod has no sidecar container", taskType, cron)
			}

			var values []string
			for _, e := range sidecar.Env {
				if e.Name == "FETCH_FORBID_LOCAL" {
					values = append(values, e.Value)
				}
			}
			if len(values) != 1 || values[0] != "true" {
				t.Fatalf("%s cron=%t: sidecar env FETCH_FORBID_LOCAL = %q, want exactly one entry with value \"true\"", taskType, cron, values)
			}
		}
	}
}
