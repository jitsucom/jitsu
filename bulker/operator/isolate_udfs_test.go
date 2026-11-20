package main

import (
	"reflect"
	"testing"

	"github.com/jitsucom/bulker/jitsubase/appbase"
	corev1 "k8s.io/api/core/v1"
)

// JITSU-263: functions-server runs UDFs of a paid class in sandboxed workers when FUNCTIONS_ISOLATE_UDFS is true.
// The operator sets it only for the workspaces named in ISOLATE_UDFS_WORKSPACE_IDS, so a canary can be widened one
// workspace at a time and rolled back by emptying the list.

func isolateUdfsEnv(t *testing.T, isolateList string, data *DeploymentData) (string, bool) {
	t.Helper()
	o := &Operator{
		Service: appbase.NewServiceBase("test"),
		config: &Config{
			KubernetesNamespace:  "newjitsu",
			FunctionsServerImage: "jitsucom/functions-server:test",
			FunctionsServerPort:  3456,
		},
		isolateUdfsWorkspaceIDs: parseIDSet(isolateList),
	}
	dep := o.buildDeploymentFromData(data)
	if dep == nil {
		t.Fatal("buildDeploymentFromData returned nil")
	}
	for _, c := range dep.Spec.Template.Spec.Containers {
		if c.Name == "mongobetween" {
			continue
		}
		for _, e := range c.Env {
			if e.Name == "FUNCTIONS_ISOLATE_UDFS" {
				return e.Value, true
			}
		}
		return "", false
	}
	t.Fatal("no functions-server container in the built deployment")
	return "", false
}

func dedicated(id string) *DeploymentData {
	return &DeploymentData{DeploymentID: id, FunctionsClass: FunctionsClassDedicated, WorkspaceIDs: []string{id}}
}

func TestListedWorkspaceGetsIsolation(t *testing.T) {
	v, ok := isolateUdfsEnv(t, "ws1", dedicated("ws1"))
	if !ok || v != "true" {
		t.Fatalf("a listed dedicated deployment must get FUNCTIONS_ISOLATE_UDFS=true, got %q (set=%v)", v, ok)
	}
	v, ok = isolateUdfsEnv(t, "ws1", &DeploymentData{DeploymentID: "ws1", FunctionsClass: FunctionsClassPremium, WorkspaceIDs: []string{"ws1"}})
	if !ok || v != "true" {
		t.Fatalf("a listed premium deployment must get FUNCTIONS_ISOLATE_UDFS=true, got %q (set=%v)", v, ok)
	}
}

// Setting the variable on every deployment, even as "false", would change every pod spec and restart all function
// servers when this operator starts. An unlisted deployment must carry no trace of it.
func TestUnlistedWorkspaceHasNoIsolationVariable(t *testing.T) {
	if v, ok := isolateUdfsEnv(t, "ws1", dedicated("ws2")); ok {
		t.Fatalf("an unlisted deployment must not carry FUNCTIONS_ISOLATE_UDFS, got %q", v)
	}
	if v, ok := isolateUdfsEnv(t, "ws1", &DeploymentData{DeploymentID: "free-0", FunctionsClass: FunctionsClassFree, WorkspaceIDs: []string{"ws1"}}); ok {
		t.Fatalf("a free shard is matched by its deployment ID, not by the workspaces it serves; got %q", v)
	}
}

func TestEmptyListChangesNothing(t *testing.T) {
	for _, list := range []string{"", " ", ",", " , ,"} {
		if v, ok := isolateUdfsEnv(t, list, dedicated("ws1")); ok {
			t.Fatalf("list %q must isolate nothing, got %q", list, v)
		}
	}
}

func TestParseIDSet(t *testing.T) {
	got := parseIDSet(" ws1, ws2 ,,ws3 ")
	want := map[string]struct{}{"ws1": {}, "ws2": {}, "ws3": {}}
	if !reflect.DeepEqual(got, want) {
		t.Fatalf("parseIDSet = %v, want %v", got, want)
	}
	if n := len(parseIDSet("")); n != 0 {
		t.Fatalf("an empty list must give an empty set, got %d entries", n)
	}
}

// The operator config hash goes into every pod template, so a change to it restarts every function server. The list must
// not be part of it. 0c73bc3178917984 is what the code before this change computed for this config.
func TestListIsNotPartOfTheGlobalConfigHash(t *testing.T) {
	c := &Config{
		FunctionsServerImage:  "jitsucom/functions-server:test",
		FunctionsServerPort:   3456,
		MongoDBURL:            "mongodb://m",
		FastStoreWorkspaceIDs: "a,b",
		FreeShards:            2,
	}
	if got := c.CalculateOperatorConfigHash(); got != "0c73bc3178917984" {
		t.Fatalf("config hash = %s, want 0c73bc3178917984 (the value before this change)", got)
	}
	c.IsolateUdfsWorkspaceIDs = "ws1,ws2"
	if got := c.CalculateOperatorConfigHash(); got != "0c73bc3178917984" {
		t.Fatalf("setting the isolate list changed the global hash to %s: every function server would restart", got)
	}
}

func buildPodTemplate(t *testing.T, isolateList string, id string) corev1.PodTemplateSpec {
	t.Helper()
	o := &Operator{
		Service: appbase.NewServiceBase("test"),
		config: &Config{
			KubernetesNamespace:  "newjitsu",
			FunctionsServerImage: "jitsucom/functions-server:test",
			FunctionsServerPort:  3456,
		},
		isolateUdfsWorkspaceIDs: parseIDSet(isolateList),
	}
	data := dedicated(id)
	data.OperatorConfigHash = o.operatorConfigHashFor(id, "basehash")
	return o.buildDeploymentFromData(data).Spec.Template
}

// Adding a workspace to the list must restart that workspace's pods (its pod template changes) and nobody else's.
func TestListChangeRestartsOnlyTheListedDeployment(t *testing.T) {
	if reflect.DeepEqual(buildPodTemplate(t, "", "ws1"), buildPodTemplate(t, "ws1", "ws1")) {
		t.Fatal("adding ws1 to the list must change ws1's pod template, or the operator will not roll its pods")
	}
	if !reflect.DeepEqual(buildPodTemplate(t, "", "ws2"), buildPodTemplate(t, "ws1", "ws2")) {
		t.Fatal("adding ws1 to the list changed the pod template of ws2: every function server would restart")
	}
	if !reflect.DeepEqual(buildPodTemplate(t, "ws1", "ws1"), buildPodTemplate(t, "ws1,ws3", "ws1")) {
		t.Fatal("adding ws3 to the list changed the pod template of ws1, which was already isolated")
	}
	if !reflect.DeepEqual(buildPodTemplate(t, "", "ws1"), buildPodTemplate(t, " ", "ws1")) {
		t.Fatal("removing ws1 from the list must give back the original pod template")
	}
}

// The reconcile loop updates a deployment only when its stored hash differs from the desired one (operator.go, "operator
// config changed"). The env var alone would never be applied: the listed deployment needs its own hash.
func TestListedDeploymentGetsItsOwnHash(t *testing.T) {
	o := &Operator{isolateUdfsWorkspaceIDs: parseIDSet("ws1")}
	if o.operatorConfigHashFor("ws1", "base") == "base" {
		t.Fatal("a listed deployment must carry a different hash, or the operator will not update it")
	}
	if got := o.operatorConfigHashFor("ws2", "base"); got != "base" {
		t.Fatalf("an unlisted deployment must keep the base hash, got %q", got)
	}
	o.isolateUdfsWorkspaceIDs = parseIDSet("")
	if got := o.operatorConfigHashFor("ws1", "base"); got != "base" {
		t.Fatalf("after ws1 leaves the list its hash must return to the base, got %q", got)
	}
}
