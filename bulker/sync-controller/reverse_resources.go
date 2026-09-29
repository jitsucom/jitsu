package main

import (
	"encoding/json"
	"fmt"
	"io"
	"strings"

	v1 "k8s.io/api/core/v1"
	"k8s.io/apimachinery/pkg/api/resource"
)

type reversePodSettings struct {
	resources v1.ResourceRequirements
	scratch   resource.Quantity
}

func defaultReversePodSettings() *reversePodSettings {
	return &reversePodSettings{
		resources: v1.ResourceRequirements{
			Requests: v1.ResourceList{v1.ResourceCPU: resource.MustParse("100m"), v1.ResourceMemory: resource.MustParse("256Mi"), v1.ResourceEphemeralStorage: resource.MustParse("1Gi")},
			Limits:   v1.ResourceList{v1.ResourceCPU: resource.MustParse("1"), v1.ResourceMemory: resource.MustParse("8Gi"), v1.ResourceEphemeralStorage: resource.MustParse("4Gi")},
		},
		scratch: resource.MustParse("2Gi"),
	}
}

// Parse once at startup, before creating any CronJobs, manual or recovery Pods.
// Runtime configuration is immutable; templates consume only validated quantities.
func (c *Config) initReversePodSettings() error {
	settings := defaultReversePodSettings()
	if c.ReverseRunnerResources != "" {
		var overrides struct {
			Requests v1.ResourceList `json:"requests"`
			Limits   v1.ResourceList `json:"limits"`
		}
		decoder := json.NewDecoder(strings.NewReader(c.ReverseRunnerResources))
		decoder.DisallowUnknownFields()
		if err := decoder.Decode(&overrides); err != nil {
			return fmt.Errorf("REVERSE_RUNNER_RESOURCES: %w", err)
		}
		if err := decoder.Decode(new(any)); err != io.EOF {
			return fmt.Errorf("REVERSE_RUNNER_RESOURCES must contain one JSON object")
		}
		for _, pair := range []struct{ src, dst v1.ResourceList }{{overrides.Requests, settings.resources.Requests}, {overrides.Limits, settings.resources.Limits}} {
			for name, quantity := range pair.src {
				if name != v1.ResourceCPU && name != v1.ResourceMemory && name != v1.ResourceEphemeralStorage {
					return fmt.Errorf("REVERSE_RUNNER_RESOURCES: unsupported resource %s", name)
				}
				if quantity.Sign() <= 0 {
					return fmt.Errorf("REVERSE_RUNNER_RESOURCES: %s must be positive", name)
				}
				pair.dst[name] = quantity
			}
		}
	}
	for name, request := range settings.resources.Requests {
		if request.Cmp(settings.resources.Limits[name]) > 0 {
			return fmt.Errorf("REVERSE_RUNNER_RESOURCES: %s request exceeds limit", name)
		}
	}
	if c.ReverseScratchSizeLimit != "" {
		quantity, err := resource.ParseQuantity(c.ReverseScratchSizeLimit)
		if err != nil || quantity.Sign() <= 0 {
			return fmt.Errorf("REVERSE_SCRATCH_SIZE_LIMIT must be a positive Kubernetes quantity")
		}
		settings.scratch = quantity
	}
	if settings.scratch.Cmp(settings.resources.Limits[v1.ResourceEphemeralStorage]) > 0 {
		return fmt.Errorf("REVERSE_SCRATCH_SIZE_LIMIT exceeds ephemeral-storage limit")
	}
	c.reversePodSettings = settings
	return nil
}

func (c *Config) reverseServiceAccount() string {
	if c.ReverseServiceAccount != "" {
		return c.ReverseServiceAccount
	}
	return c.PodsServiceAccount
}

func (c *Config) reverseSettings() *reversePodSettings {
	if c.reversePodSettings != nil {
		return c.reversePodSettings
	}
	// Struct-literal test configs (without PostInit) retain production defaults.
	return defaultReversePodSettings()
}
