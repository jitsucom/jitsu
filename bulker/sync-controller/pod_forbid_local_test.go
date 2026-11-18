package main

import (
	"reflect"
	"testing"

	v1 "k8s.io/api/core/v1"
)

// sidecarEnvValues returns every value of the named env var on the container called "sidecar".
func sidecarEnvValues(t *testing.T, cfg *Config, taskType string, cron bool, name string) []string {
	t.Helper()
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
		if e.Name == name {
			values = append(values, e.Value)
		}
	}
	return values
}

// A connector sync can write to a webhook destination whose URL the customer typed in. The sidecar sends those
// requests, so its container has to run the outbound HTTP client with the local-address guard switched on
// (FETCH_FORBID_LOCAL, read by bulkerlib/implementations/api_based/guarded_http.go). Without it a sync pod can be
// pointed at the cluster's own network: in-cluster services, the node and the cloud metadata address (JITSU-258).
func TestSidecarForbidsLocalOutboundAddresses(t *testing.T) {
	for _, taskType := range []string{"spec", "check", "discover", "read"} {
		for _, cron := range []bool{false, true} {
			values := sidecarEnvValues(t, reverseTestConfig(), taskType, cron, "FETCH_FORBID_LOCAL")
			if !reflect.DeepEqual(values, []string{"true"}) {
				t.Fatalf("%s cron=%t: sidecar env FETCH_FORBID_LOCAL = %q, want exactly one entry with value \"true\"", taskType, cron, values)
			}
		}
	}
}

// The guard is on by default but an operator can change it: a self-hosted install that syncs to a webhook on its own
// network turns it off or lists the host it trusts, through syncctl settings that reach the sidecar.
func TestSidecarFetchGuardFollowsSyncctlSettings(t *testing.T) {
	cases := []struct {
		name       string
		forbid     string
		whitelist  string
		wantForbid string
		wantWhite  []string
	}{
		{name: "unset keeps the guard on", forbid: "", whitelist: "", wantForbid: "true", wantWhite: nil},
		{name: "explicit true", forbid: "true", wantForbid: "true"},
		{name: "explicit false turns it off", forbid: "false", wantForbid: "false"},
		{name: "surrounding spaces are trimmed", forbid: " false ", wantForbid: "false"},
		{name: "whitespace only keeps the guard on", forbid: "   ", wantForbid: "true"},
		{name: "whitelist reaches the sidecar", forbid: "true", whitelist: "intranet.corp,10.0.0.5", wantForbid: "true", wantWhite: []string{"intranet.corp,10.0.0.5"}},
		{name: "blank whitelist passes nothing", forbid: "true", whitelist: "  ", wantForbid: "true", wantWhite: nil},
	}
	for _, tc := range cases {
		for _, taskType := range []string{"check", "read"} {
			for _, cron := range []bool{false, true} {
				cfg := reverseTestConfig()
				cfg.SyncFetchForbidLocal = tc.forbid
				cfg.SyncFetchLocalWhitelist = tc.whitelist
				if got := sidecarEnvValues(t, cfg, taskType, cron, "FETCH_FORBID_LOCAL"); !reflect.DeepEqual(got, []string{tc.wantForbid}) {
					t.Errorf("%s (%s cron=%t): FETCH_FORBID_LOCAL = %q, want [%q]", tc.name, taskType, cron, got, tc.wantForbid)
				}
				if got := sidecarEnvValues(t, cfg, taskType, cron, "FETCH_LOCAL_WHITELIST"); !reflect.DeepEqual(got, tc.wantWhite) {
					t.Errorf("%s (%s cron=%t): FETCH_LOCAL_WHITELIST = %q, want %q", tc.name, taskType, cron, got, tc.wantWhite)
				}
			}
		}
	}
}
