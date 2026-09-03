package main

import "testing"

func TestBuildIndexedJobUsesConfiguredWorkerServiceAccount(t *testing.T) {
	client := &K8sJobClient{config: &Config{
		K8sMaxParallelWorkers:            10,
		ReprocessingWorkerImage:          "worker:latest",
		ReprocessingWorkerServiceAccount: "reprocessing-gcs",
	}}

	job := client.buildIndexedJob("job", "files", "config", "secret", "job-id", 1, 0)
	if got := job.Spec.Template.Spec.ServiceAccountName; got != "reprocessing-gcs" {
		t.Fatalf("service account = %q, want %q", got, "reprocessing-gcs")
	}
}
