package main

import (
	"context"
	"testing"

	"github.com/jitsucom/bulker/jitsubase/appbase"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	"k8s.io/client-go/kubernetes/fake"
)

func TestHPAMaxByDeployment(t *testing.T) {
	ctx := context.Background()
	client := fake.NewSimpleClientset()
	t.Setenv("OPERATOR_REPOSITORY_BASE_URL", "test")
	t.Setenv("OPERATOR_HPA_ENABLED", "true")
	t.Setenv("OPERATOR_HPA_MAX_REPLICAS", "80")
	t.Setenv("OPERATOR_KUBERNETES_NAMESPACE", "test")
	t.Setenv("OPERATOR_INSTANCE_ID", "test")
	t.Setenv("OPERATOR_HPA_MAX_REPLICAS_BY_DEPLOYMENT", `{"heavy":96}`)
	c := &Config{}
	if err := appbase.InitAppConfig(c, &appbase.AppSettings{ConfigPath: t.TempDir(), ConfigName: "operator", ConfigType: "yaml", EnvPrefix: "OPERATOR"}); err != nil {
		t.Fatal(err)
	}
	op := &Operator{clientset: client, config: c, Service: appbase.NewServiceBase("test")}
	desired := map[string]*DeploymentData{}
	for _, id := range []string{"heavy", "other"} {
		d := &DeploymentData{DeploymentID: id, FunctionsClass: FunctionsClassPremium}
		desired[id] = d
		if err := op.createOrUpdateHPA(ctx, d); err != nil {
			t.Fatal(err)
		}
	}
	hpas := client.AutoscalingV2().HorizontalPodAutoscalers("test")
	check := func(id string, max int32, override bool) {
		t.Helper()
		h, err := hpas.Get(ctx, id+hpaSuffix, metav1.GetOptions{})
		if err != nil {
			t.Fatal(err)
		}
		if h.Spec.MaxReplicas != max || (h.Annotations[annotationHPAMaxOverride] != "") != override {
			t.Fatalf("%s got maximum %d and annotations %v", id, h.Spec.MaxReplicas, h.Annotations)
		}
	}
	check("heavy", 96, true)
	check("other", 80, false)
	reconcile := func(wantWrites int) {
		t.Helper()
		client.ClearActions()
		if err := op.reconcileHPAMaxOverrides(ctx, desired); err != nil {
			t.Fatal(err)
		}
		writes := 0
		for _, a := range client.Actions() {
			if a.GetVerb() == "list" {
				continue
			}
			if a.GetVerb() != "update" || a.GetResource().Resource != "horizontalpodautoscalers" {
				t.Fatalf("unexpected API action: %v", a)
			}
			writes++
		}
		if writes != wantWrites {
			t.Fatalf("expected %d HPA updates, got %d", wantWrites, writes)
		}
	}
	reconcile(0)
	c.maxReplicasByDeployment["heavy"] = 100
	reconcile(1)
	check("heavy", 100, true)
	delete(c.maxReplicasByDeployment, "heavy")
	reconcile(1)
	check("heavy", 80, false)
	c.maxReplicasByDeployment["other"] = 96
	reconcile(1)
	check("other", 96, true)
	reconcile(0)
}

func TestInvalidHPAMaxByDeployment(t *testing.T) {
	for _, raw := range []string{"null", `{"heavy":0}`, `{"heavy":"large"}`, `{"":96}`} {
		c := Config{RepositoryBaseURL: "test", HPAMaxReplicasByDeployment: raw}
		if err := c.PostInit(&appbase.AppSettings{}); err == nil {
			t.Errorf("accepted invalid override %s", raw)
		}
	}
}
