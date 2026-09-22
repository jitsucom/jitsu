package main

import (
	"testing"

	"github.com/jitsucom/bulker/jitsubase/appbase"
	corev1 "k8s.io/api/core/v1"
)

// The functions-server crash-looped for half an hour on 21 Sep 2026 because it
// had no StartupProbe: liveness began counting at 10s and killed the container
// after 5 failures — a ~60s budget — while startup was still loading every
// workspace's connections and functions. Measured start-to-ready was 26s with
// two pods and 61s when a config change rolled 32 at once.
//
// These assert the probe exists and that its budget stays well clear of the
// worst case observed. Without them nothing stops the probe being dropped or
// its threshold quietly lowered.

func buildFunctionsServerContainer(t *testing.T) corev1.Container {
	t.Helper()
	o := &Operator{
		Service: appbase.NewServiceBase("test"),
		config: &Config{
			KubernetesNamespace:  "newjitsu",
			FunctionsServerImage: "jitsucom/functions-server:test",
			FunctionsServerPort:  3456,
		},
	}
	dep := o.buildDeploymentFromData(&DeploymentData{
		DeploymentID:   "free-3-5",
		FunctionsClass: "free",
		WorkspaceIDs:   []string{"ws1"},
	})
	if dep == nil {
		t.Fatal("buildDeploymentFromData returned nil")
	}
	for _, c := range dep.Spec.Template.Spec.Containers {
		if c.Name != "mongobetween" {
			return c
		}
	}
	t.Fatal("no functions-server container in the built deployment")
	return corev1.Container{}
}

func TestFunctionsServerHasStartupProbe(t *testing.T) {
	c := buildFunctionsServerContainer(t)
	if c.StartupProbe == nil {
		t.Fatal("functions-server has no StartupProbe; liveness will kill slow startups (21 Sep 2026 incident)")
	}
	if c.StartupProbe.HTTPGet == nil || c.StartupProbe.HTTPGet.Path != "/health" {
		t.Errorf("StartupProbe should GET /health, got %+v", c.StartupProbe.ProbeHandler)
	}
}

func TestStartupProbeBudgetClearsTheWorstObservedStartup(t *testing.T) {
	c := buildFunctionsServerContainer(t)
	if c.StartupProbe == nil {
		t.Fatal("no StartupProbe")
	}
	budget := c.StartupProbe.PeriodSeconds * c.StartupProbe.FailureThreshold
	// 61s was the worst start-to-ready measured during the incident. Anything
	// under ~3x that is too tight for a rollout that restarts the whole shard.
	if budget < 180 {
		t.Errorf("startup budget is %ds (period %d x threshold %d); worst observed startup was 61s, want >=180s",
			budget, c.StartupProbe.PeriodSeconds, c.StartupProbe.FailureThreshold)
	}
}

func TestLivenessStillPresentAndUnchanged(t *testing.T) {
	c := buildFunctionsServerContainer(t)
	if c.LivenessProbe == nil {
		t.Fatal("functions-server lost its LivenessProbe")
	}
	// Liveness only begins after StartupProbe succeeds, so these values are now
	// measured from "server is up" rather than from container start.
	if c.LivenessProbe.FailureThreshold != 5 || c.LivenessProbe.PeriodSeconds != 10 {
		t.Errorf("liveness changed unexpectedly: threshold=%d period=%d",
			c.LivenessProbe.FailureThreshold, c.LivenessProbe.PeriodSeconds)
	}
}

// The StartupProbe is hardcoded in buildDeploymentFromData, so it contributes
// nothing to any Config field. The reconcile loop only updates a live
// deployment when ConfigHash, OperatorConfigHash or FunctionsClass changes, so
// without podSpecVersion in the hash the probe would reach existing deployments
// only when some unrelated workspace edit happened to roll them — and the
// deploy itself would appear to do nothing.
func TestPodSpecVersionForcesARollout(t *testing.T) {
	cfg := &Config{
		FunctionsServerImage: "jitsucom/functions-server:test",
		FunctionsServerPort:  3456,
		MongobetweenImage:    "jitsucom/mongobetween:test",
		MongobetweenPort:     27017,
	}
	before := cfg.CalculateOperatorConfigHash()

	orig := podSpecVersion
	t.Cleanup(func() { podSpecVersion = orig })
	podSpecVersion = orig + "-next"

	after := cfg.CalculateOperatorConfigHash()
	if before == after {
		t.Fatal("bumping podSpecVersion did not change OperatorConfigHash; a pod spec change would not roll existing deployments")
	}
}

func TestOperatorConfigHashIsStableForIdenticalConfig(t *testing.T) {
	mk := func() *Config {
		return &Config{
			FunctionsServerImage: "jitsucom/functions-server:test",
			FunctionsServerPort:  3456,
			MongobetweenImage:    "jitsucom/mongobetween:test",
			MongobetweenPort:     27017,
		}
	}
	if mk().CalculateOperatorConfigHash() != mk().CalculateOperatorConfigHash() {
		t.Fatal("hash is unstable for identical config — every reconcile would roll every deployment")
	}
}
