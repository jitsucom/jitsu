package main

import (
	"strings"
	"testing"

	"github.com/jitsucom/bulker/jitsubase/appbase"
	v1 "k8s.io/api/core/v1"
	"k8s.io/apimachinery/pkg/api/resource"
)

func TestReverseResourcesValidation(t *testing.T) {
	for _, tc := range []struct {
		name, resources, scratch string
	}{
		{"invalid JSON", `{`, ""},
		{"extra JSON", `{} {}`, ""},
		{"unknown field", `{"request":{}}`, ""},
		{"unknown resource", `{"limits":{"gpu":"1"}}`, ""},
		{"invalid quantity", `{"limits":{"cpu":"many"}}`, ""},
		{"negative limit", `{"limits":{"cpu":"-1"}}`, ""},
		{"zero request", `{"requests":{"cpu":"0"}}`, ""},
		{"request exceeds limit", `{"requests":{"memory":"9Gi"}}`, ""},
		{"scratch exceeds limit", `{"limits":{"ephemeral-storage":"1Gi"}}`, ""},
		{"invalid scratch", "", "large"},
		{"zero scratch", "", "0"},
	} {
		t.Run(tc.name, func(t *testing.T) {
			cfg := reverseTestConfig()
			cfg.ReverseRunnerResources, cfg.ReverseScratchSizeLimit = tc.resources, tc.scratch
			if err := cfg.initReversePodSettings(); err == nil {
				t.Fatal("invalid runner resources accepted")
			}
		})
	}
}

func TestReverseResourcesValidatedAtStartup(t *testing.T) {
	cfg := reverseTestConfig()
	cfg.RepositoryBaseURL = "http://console/api/admin/export"
	cfg.ReverseRunnerResources = `{"requests":{"memory":"9Gi"}}`
	if err := cfg.PostInit(&appbase.AppSettings{}); err == nil || !strings.Contains(err.Error(), "request exceeds limit") {
		t.Fatalf("startup did not reject invalid resources: %v", err)
	}
}

func TestReverseResourcesAndIdentity(t *testing.T) {
	cfg, entry := reverseTestConfig(), reverseFixture()
	if err := cfg.initReversePodSettings(); err != nil {
		t.Fatal(err)
	}
	pod := buildReversePodTemplate(cfg, entry, "config", "")
	if pod.Spec.ServiceAccountName != cfg.PodsServiceAccount {
		t.Fatal("legacy service account fallback lost")
	}
	if pod.Spec.Containers[0].Resources.Requests.Cpu().String() != "100m" || pod.Spec.Containers[0].Resources.Limits.StorageEphemeral().String() != "4Gi" || pod.Spec.Volumes[1].EmptyDir.SizeLimit.String() != "2Gi" {
		t.Fatal("unexpected defaults")
	}
	cfg.ReverseServiceAccount = "retl-only"
	cfg.ReverseRunnerResources = `{"requests":{"cpu":"500m","ephemeral-storage":"3Gi"},"limits":{"memory":"2Gi","ephemeral-storage":"8Gi"}}`
	cfg.ReverseScratchSizeLimit = "6Gi"
	if err := cfg.initReversePodSettings(); err != nil {
		t.Fatal(err)
	}
	// Both the CronJob path and manual/recovery paths share this builder.
	for _, taskID := range []string{"", "manual", "recovery"} {
		pod := buildReversePodTemplate(cfg, entry, "config", taskID)
		resources := pod.Spec.Containers[0].Resources
		if pod.Spec.ServiceAccountName != "retl-only" || resources.Requests.Cpu().String() != "500m" || resources.Requests.Memory().String() != "256Mi" || resources.Limits.Memory().String() != "2Gi" || resources.Limits.StorageEphemeral().String() != "8Gi" || pod.Spec.Volumes[1].EmptyDir.SizeLimit.String() != "6Gi" {
			t.Fatal("runner settings not applied")
		}
		resources.Limits[v1.ResourceMemory] = resource.MustParse("99Gi")
		if cfg.reverseSettings().resources.Limits.Memory().String() != "2Gi" {
			t.Fatal("template mutation modified cached settings")
		}
	}
	if cfg.PodsServiceAccount != "runner" {
		t.Fatal("connector identity changed")
	}
}

func TestReverseDriftIncludesResourcesAndIdentity(t *testing.T) {
	cfg, entry := reverseTestConfig(), reverseFixture()
	c := &CronJobController{config: cfg, reverse: true}
	for _, update := range []func(){
		func() { cfg.ReverseServiceAccount = "retl-only" },
		func() { cfg.ReverseRunnerResources = `{"limits":{"cpu":"2"}}` },
		func() { cfg.ReverseScratchSizeLimit = "3Gi" },
	} {
		before := c.configHash(entry)
		update()
		if err := cfg.initReversePodSettings(); err != nil {
			t.Fatal(err)
		}
		if c.configHash(entry) == before {
			t.Fatal("runner settings drift missed")
		}
	}
}
