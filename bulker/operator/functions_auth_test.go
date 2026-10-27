package main

import "testing"

func TestFunctionsPublicKeyTriggersReconciliation(t *testing.T) {
	config := &Config{FunctionsServerImage: "same-image"}
	initial := config.CalculateOperatorConfigHash()
	config.FunctionsServerPublicKey = "first-public-key"
	first := config.CalculateOperatorConfigHash()
	config.FunctionsServerPublicKey = "rotated-public-key"
	rotated := config.CalculateOperatorConfigHash()
	if initial == first || first == rotated {
		t.Fatal("provisioning and rotating the verification key must reconcile existing functions deployments")
	}
}
