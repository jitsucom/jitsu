package main

import "testing"

func TestSyncAdmissionExtraCA(t *testing.T) {
	for _, ca := range []string{"", "local-ca"} {
		for _, taskType := range []string{"read", "spec"} {
			cfg := reverseTestConfig()
			cfg.ExtraCAConfigMap = ca
			pod := buildSyncPodTemplate(cfg, PodCtx{TaskType: taskType, Inline: &InlinePayload{Package: "test", Version: "latest"}}, "config")
			found := false
			for _, container := range pod.Spec.InitContainers {
				for _, env := range container.Env {
					if env.Name == "SSL_CERT_FILE" {
						if container.Name != "admission" || ca == "" || env.Value != "/etc/jitsu-ca/ca.crt" {
							t.Fatal("CA trust must be limited to admission")
						}
						found = true
						if len(container.VolumeMounts) != 1 || !container.VolumeMounts[0].ReadOnly {
							t.Fatal("admission needs a read-only CA mount")
						}
					}
				}
			}
			if found != (ca != "" && taskType == "read") {
				t.Fatal("incorrect admission trust configuration")
			}
			for _, container := range pod.Spec.Containers {
				for _, mount := range container.VolumeMounts {
					if mount.Name == "extra-ca" {
						t.Fatal("CA must not be injected into source connectors")
					}
				}
			}
		}
	}
}
