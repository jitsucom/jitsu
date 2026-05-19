package main

import (
	"context"
	"time"

	"k8s.io/apimachinery/pkg/api/errors"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	"k8s.io/client-go/kubernetes"
)

// IsSyncLeaseHeld returns true if a coordination/v1 Lease named after the
// syncId currently exists with a fresh renewTime. Used by the /run admission
// gate to fail-fast manual triggers when a cron-spawned (or other manual)
// sync run is already in flight.
//
// The Lease object is created+renewed by sync-sidecar's lease subcommands
// (see bulker/sync-sidecar/lease.go); leaseDurationSeconds defaults to 60s
// there, so we use the same expiry test here.
//
// Lookup MUST use the same name normalization the sidecar uses to write the
// lease — k8s Lease.metadata.name is RFC 1123 (lowercase + `-`), but raw
// syncIDs are mixed case. Without this, the admission check missed live
// leases for any sync whose ID contains uppercase letters, and duplicate
// runs slipped through. `k8sName` here matches `LeaseNameForSync` in the
// sidecar character-for-character; keep them in sync (TODO: extract to a
// shared `jitsubase/k8sname` package).
func IsSyncLeaseHeld(clientset *kubernetes.Clientset, namespace, syncID string) (bool, error) {
	if clientset == nil || syncID == "" {
		return false, nil
	}
	leaseName := k8sName(syncID)
	if leaseName == "" {
		return false, nil
	}
	lease, err := clientset.CoordinationV1().Leases(namespace).Get(context.Background(), leaseName, metav1.GetOptions{})
	if err != nil {
		if errors.IsNotFound(err) {
			return false, nil
		}
		return false, err
	}
	if lease.Spec.RenewTime == nil {
		return false, nil
	}
	dur := time.Duration(60) * time.Second
	if lease.Spec.LeaseDurationSeconds != nil && *lease.Spec.LeaseDurationSeconds > 0 {
		dur = time.Duration(*lease.Spec.LeaseDurationSeconds) * time.Second
	}
	return time.Now().Before(lease.Spec.RenewTime.Add(dur)), nil
}
