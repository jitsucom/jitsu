package main

import (
	"bytes"
	"crypto/tls"
	"crypto/x509"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"os"
	"os/signal"
	"strconv"
	"strings"
	"sync/atomic"
	"syscall"
	"time"

	"github.com/jitsucom/bulker/jitsubase/logging"
)

// Lease subcommand + helpers. Implemented against the Kubernetes coordination/v1
// Lease API directly via HTTP (using the in-cluster service account credentials)
// to avoid pulling client-go into sync-sidecar's dependency closure.
//
// Per-sync mutual exclusion model:
//   - Lease name: SYNC_ID
//   - Holder identity: SYNC_ID (the lease *represents* the sync run, not a pod)
//   - leaseDurationSeconds: 60
//   - Init container `lease-acquire` calls Acquire() with a short retry budget
//     and exits non-zero if the lease is currently held (= another pod for this
//     same sync is already running)
//   - Main sidecar runs RenewLeaseLoop() in a goroutine, refreshing every 20s.
//     If a refresh detects we no longer hold the lease (renewTime advanced past
//     ours, or the lease object disappeared and was recreated by someone else),
//     the sidecar SIGTERMs PID 1 to terminate the entire Pod.

const (
	leaseAPIPath            = "/apis/coordination.k8s.io/v1/namespaces/%s/leases"
	leaseSAPath             = "/var/run/secrets/kubernetes.io/serviceaccount"
	leaseDurationSeconds    = 60
	leaseAcquireMaxAttempts = 10
	leaseAcquireBackoff     = 500 * time.Millisecond
	leaseRenewInterval      = 20 * time.Second

	// coordination.k8s.io/v1 LeaseSpec.acquireTime / renewTime are MicroTime,
	// which k8s.io/apimachinery parses with this exact layout (always 6
	// fractional digits) and does NOT fall back to RFC3339. Sending plain
	// RFC3339 (no fractional seconds) is rejected with a 400.
	leaseMicroTimeFormat = "2006-01-02T15:04:05.000000Z07:00"
)

type Lease struct {
	APIVersion string        `json:"apiVersion"`
	Kind       string        `json:"kind"`
	Metadata   LeaseMetadata `json:"metadata"`
	Spec       LeaseSpec     `json:"spec"`
}

type LeaseMetadata struct {
	Name            string `json:"name"`
	Namespace       string `json:"namespace,omitempty"`
	ResourceVersion string `json:"resourceVersion,omitempty"`
}

type LeaseSpec struct {
	HolderIdentity       string `json:"holderIdentity,omitempty"`
	LeaseDurationSeconds int32  `json:"leaseDurationSeconds,omitempty"`
	AcquireTime          string `json:"acquireTime,omitempty"`
	RenewTime            string `json:"renewTime,omitempty"`
}

type leaseClient struct {
	http      *http.Client
	apiServer string
	token     string
	namespace string
}

// Package-level lease state. Both the lease-renewer goroutine's signal
// handler AND the main sidecar's natural-exit defer (main.go:113) need to
// read these — without that, the deferred ReleaseSyncLease() would delete
// a lease that another pod has since taken over (lost-lease path), allowing
// duplicate concurrent runs.
//   - leaseLost: set by startLeaseRenewer when Renew() returns ok=false.
//     ReleaseSyncLease() short-circuits when this is true.
//   - leaseReleased: ensures the actual DELETE call happens at most once
//     across signal-driven and defer-driven paths.
var (
	leaseLost     atomic.Bool
	leaseReleased atomic.Bool
)

// releaseLeaseOnce performs a best-effort lease delete at most once. Both
// release paths (renewer SIGTERM handler, ReleaseSyncLease() natural-exit
// defer) funnel through it.
func releaseLeaseOnce(c *leaseClient, syncID, reason string) {
	if leaseReleased.CompareAndSwap(false, true) {
		name := LeaseNameForSync(syncID)
		logging.Infof("[lease] releasing lease %q (sync %s, %s)", name, syncID, reason)
		c.Release(name)
	}
}

func newLeaseClient(namespace string) (*leaseClient, error) {
	tokenBytes, err := os.ReadFile(leaseSAPath + "/token")
	if err != nil {
		return nil, fmt.Errorf("read SA token: %w", err)
	}
	caBytes, err := os.ReadFile(leaseSAPath + "/ca.crt")
	if err != nil {
		return nil, fmt.Errorf("read SA ca: %w", err)
	}
	pool := x509.NewCertPool()
	if !pool.AppendCertsFromPEM(caBytes) {
		return nil, errors.New("appending SA ca to cert pool")
	}
	host := os.Getenv("KUBERNETES_SERVICE_HOST")
	port := os.Getenv("KUBERNETES_SERVICE_PORT")
	if host == "" {
		host = "kubernetes.default.svc"
	}
	if port == "" {
		port = "443"
	}
	return &leaseClient{
		http: &http.Client{
			Timeout: 10 * time.Second,
			Transport: &http.Transport{
				TLSClientConfig: &tls.Config{RootCAs: pool},
			},
		},
		apiServer: fmt.Sprintf("https://%s:%s", host, port),
		token:     string(bytes.TrimSpace(tokenBytes)),
		namespace: namespace,
	}, nil
}

func (c *leaseClient) url(name string) string {
	if name == "" {
		return c.apiServer + fmt.Sprintf(leaseAPIPath, c.namespace)
	}
	return c.apiServer + fmt.Sprintf(leaseAPIPath, c.namespace) + "/" + name
}

func (c *leaseClient) do(method, name string, body any) (*Lease, int, error) {
	var reqBody io.Reader
	if body != nil {
		b, err := json.Marshal(body)
		if err != nil {
			return nil, 0, err
		}
		reqBody = bytes.NewReader(b)
	}
	req, err := http.NewRequest(method, c.url(name), reqBody)
	if err != nil {
		return nil, 0, err
	}
	req.Header.Set("Authorization", "Bearer "+c.token)
	req.Header.Set("Accept", "application/json")
	if body != nil {
		req.Header.Set("Content-Type", "application/json")
	}
	resp, err := c.http.Do(req)
	if err != nil {
		return nil, 0, err
	}
	defer resp.Body.Close()
	respBody, _ := io.ReadAll(resp.Body)
	if resp.StatusCode == http.StatusNotFound {
		return nil, resp.StatusCode, nil
	}
	if resp.StatusCode >= 400 {
		return nil, resp.StatusCode, fmt.Errorf("k8s API %d: %s", resp.StatusCode, string(respBody))
	}
	if len(respBody) == 0 {
		return nil, resp.StatusCode, nil
	}
	out := &Lease{}
	if err := json.Unmarshal(respBody, out); err != nil {
		return nil, resp.StatusCode, fmt.Errorf("decode lease response: %w", err)
	}
	return out, resp.StatusCode, nil
}

func (c *leaseClient) Get(name string) (*Lease, error) {
	l, status, err := c.do("GET", name, nil)
	if err != nil {
		return nil, err
	}
	if status == http.StatusNotFound {
		return nil, nil
	}
	return l, nil
}

// Acquire returns true if we successfully claim the lease for `identity`.
// Returns false (no error) when the lease is currently held by a fresh holder.
func (c *leaseClient) Acquire(name, identity string) (bool, error) {
	now := time.Now().UTC().Format(leaseMicroTimeFormat)
	existing, err := c.Get(name)
	if err != nil {
		return false, err
	}

	if existing == nil {
		// Create a fresh lease.
		newLease := &Lease{
			APIVersion: "coordination.k8s.io/v1",
			Kind:       "Lease",
			Metadata:   LeaseMetadata{Name: name, Namespace: c.namespace},
			Spec: LeaseSpec{
				HolderIdentity:       identity,
				LeaseDurationSeconds: leaseDurationSeconds,
				AcquireTime:          now,
				RenewTime:            now,
			},
		}
		_, status, err := c.do("POST", "", newLease)
		if err != nil {
			if status == http.StatusConflict {
				// Lost a race with another pod creating it; reload and treat as held.
				return false, nil
			}
			return false, err
		}
		return true, nil
	}

	// Lease exists — is it stale?
	if !leaseIsStale(existing) {
		return false, nil
	}

	// Take it over.
	existing.Spec.HolderIdentity = identity
	existing.Spec.LeaseDurationSeconds = leaseDurationSeconds
	existing.Spec.AcquireTime = now
	existing.Spec.RenewTime = now
	_, status, err := c.do("PUT", name, existing)
	if err != nil {
		if status == http.StatusConflict {
			// Another pod won the race.
			return false, nil
		}
		return false, err
	}
	return true, nil
}

// Renew extends our hold on the lease. Returns false if the lease was taken
// by someone else (renewTime advanced past ours, or it disappeared).
func (c *leaseClient) Renew(name, identity string) (bool, error) {
	existing, err := c.Get(name)
	if err != nil {
		return false, err
	}
	if existing == nil || existing.Spec.HolderIdentity != identity {
		return false, nil
	}
	existing.Spec.RenewTime = time.Now().UTC().Format(leaseMicroTimeFormat)
	_, status, err := c.do("PUT", name, existing)
	if err != nil {
		if status == http.StatusConflict || status == http.StatusNotFound {
			return false, nil
		}
		return false, err
	}
	return true, nil
}

// Release best-effort deletes the lease so the next acquire is unblocked.
// Failures are logged but not returned — the lease will expire naturally
// after leaseDurationSeconds anyway.
func (c *leaseClient) Release(name string) {
	_, _, err := c.do("DELETE", name, nil)
	if err != nil {
		logging.Warnf("[lease] release %q failed (will expire on its own): %v", name, err)
	}
}

func leaseIsStale(l *Lease) bool {
	if l.Spec.RenewTime == "" {
		return true
	}
	renewedAt, err := time.Parse(leaseMicroTimeFormat, l.Spec.RenewTime)
	if err != nil {
		// If we can't parse, treat as stale so we can take over.
		return true
	}
	dur := time.Duration(l.Spec.LeaseDurationSeconds) * time.Second
	if dur == 0 {
		dur = leaseDurationSeconds * time.Second
	}
	return time.Now().After(renewedAt.Add(dur))
}

// leaseHolderIdentity returns the identity this Pod uses on the Lease.
// Pod-unique (POD_NAME via downward API) so Renew() can detect when another
// Pod has taken over the same Lease object — both Pods of the same sync
// would otherwise share the same identity and neither could detect takeover.
// Falls back to the hostname (which kubelet sets equal to the pod name on
// vanilla configurations) if POD_NAME isn't injected.
func leaseHolderIdentity() string {
	if name := os.Getenv("POD_NAME"); name != "" {
		return name
	}
	if hostname, err := os.Hostname(); err == nil && hostname != "" {
		return hostname
	}
	return "unknown"
}

// runLeaseAcquire is the lease-acquire init container entry point. Reads
// SYNC_ID + KUBE_NAMESPACE from env, retries acquire briefly, exits 0 on
// success or 1 on failure (fresh lease held by another pod).
func runLeaseAcquire() {
	syncID := os.Getenv("SYNC_ID")
	namespace := os.Getenv("KUBE_NAMESPACE")
	if syncID == "" || namespace == "" {
		logging.Errorf("[lease-acquire] SYNC_ID and KUBE_NAMESPACE are required")
		os.Exit(2)
	}
	identity := leaseHolderIdentity()
	c, err := newLeaseClient(namespace)
	if err != nil {
		logging.Errorf("[lease-acquire] init: %v", err)
		os.Exit(2)
	}
	leaseName := LeaseNameForSync(syncID)
	for attempt := 1; attempt <= leaseAcquireMaxAttempts; attempt++ {
		acquired, err := c.Acquire(leaseName, identity)
		if err != nil {
			logging.Warnf("[lease-acquire] attempt %d: %v", attempt, err)
		} else if acquired {
			logging.Infof("[lease-acquire] acquired lease %q (sync %s) as %q", leaseName, syncID, identity)
			os.Exit(0)
		} else {
			logging.Infof("[lease-acquire] attempt %d: lease %q (sync %s) held by another holder", attempt, leaseName, syncID)
		}
		time.Sleep(leaseAcquireBackoff)
	}
	logging.Errorf("[lease-acquire] giving up after %d attempts; lease %q (sync %s) is held", leaseAcquireMaxAttempts, leaseName, syncID)
	os.Exit(1)
}

// startLeaseRenewer launches a background goroutine that keeps the lease
// alive while the main sidecar processes records. If the lease can't be
// renewed (lost it — i.e. another pod with a different identity took it
// over), the goroutine SIGTERMs PID 1 to terminate the Pod and stop the
// sync mid-flight.
//
// Also installs a SIGTERM/SIGINT handler that releases the lease on clean
// shutdown so the next scheduled or manual run isn't blocked waiting for
// TTL expiry. (Without an explicit Release, the lease lingers up to
// leaseDurationSeconds after the run exits, which can falsely 409 a
// manual retry that comes in seconds after a successful sync.)
//
// Triggered when env RENEW_LEASE=true is set on the sidecar container.
func startLeaseRenewer() {
	if os.Getenv("RENEW_LEASE") != "true" {
		return
	}
	syncID := os.Getenv("SYNC_ID")
	namespace := os.Getenv("KUBE_NAMESPACE")
	if syncID == "" || namespace == "" {
		logging.Warnf("[lease-renew] disabled: SYNC_ID and KUBE_NAMESPACE both required")
		return
	}
	identity := leaseHolderIdentity()
	client, err := newLeaseClient(namespace)
	if err != nil {
		logging.Errorf("[lease-renew] init: %v (sidecar will continue WITHOUT lease renewal)", err)
		return
	}

	// Cleanup on SIGTERM/SIGINT (graceful shutdown from kubelet on Pod
	// completion, or from the user). Lost-lease path skips Release because
	// another pod owns the Lease now.
	sigCh := make(chan os.Signal, 1)
	signal.Notify(sigCh, syscall.SIGTERM, syscall.SIGINT)
	go func() {
		<-sigCh
		if !leaseLost.Load() {
			releaseLeaseOnce(client, syncID, "signal received")
		}
	}()

	go func() {
		t := time.NewTicker(leaseRenewInterval)
		defer t.Stop()
		for {
			<-t.C
			if leaseLost.Load() {
				return
			}
			ok, err := client.Renew(LeaseNameForSync(syncID), identity)
			if err != nil {
				logging.Warnf("[lease-renew] %v (will retry)", err)
				continue
			}
			if !ok {
				leaseLost.Store(true)
				logging.Errorf("[lease-renew] lease %q (sync %s) lost — terminating Pod", LeaseNameForSync(syncID), syncID)
				// shareProcessNamespace=true means the source connector's
				// process is reachable. SIGTERM PID 1 (the pause container);
				// kubelet will clean up siblings.
				if err := syscall.Kill(1, syscall.SIGTERM); err != nil {
					logging.Errorf("[lease-renew] SIGTERM PID 1 failed: %v", err)
					os.Exit(int(syscall.SIGTERM))
				}
				return
			}
		}
	}()
}

// ReleaseSyncLease is callable from the main sidecar's normal-exit path
// (the defer in main.go). Idempotent and best-effort. Critically, this
// short-circuits when the renewer has already detected lease-loss — at
// that point another Pod owns the Lease object and deleting it would
// reopen the gate for duplicate concurrent runs of the same sync.
func ReleaseSyncLease() {
	if os.Getenv("RENEW_LEASE") != "true" {
		return
	}
	if leaseLost.Load() {
		// Another Pod now holds this lease — don't delete its claim.
		return
	}
	if leaseReleased.Load() {
		// Already released by the renewer's signal handler.
		return
	}
	syncID := os.Getenv("SYNC_ID")
	namespace := os.Getenv("KUBE_NAMESPACE")
	if syncID == "" || namespace == "" {
		return
	}
	client, err := newLeaseClient(namespace)
	if err != nil {
		logging.Warnf("[lease-release] init: %v", err)
		return
	}
	releaseLeaseOnce(client, syncID, "natural exit")
}

// Helper used by syncctl's /run admission gate (via HTTP, not in this binary).
// Kept here so the lease key naming convention has one definition.
//
// Lease.metadata.name is an RFC 1123 subdomain (lowercase + `-` only), but
// sync IDs come from juava's randomId() with alphabet `0-9a-zA-Z`. Sanitize
// here so every lease verb (acquire/renew/release) and every external caller
// produces the same name for a given syncID.
func LeaseNameForSync(syncID string) string {
	var b strings.Builder
	b.Grow(len(syncID))
	for _, r := range syncID {
		switch {
		case r >= 'a' && r <= 'z', r >= '0' && r <= '9', r == '-':
			b.WriteRune(r)
		case r >= 'A' && r <= 'Z':
			b.WriteRune(r + ('a' - 'A'))
		default:
			b.WriteRune('-')
		}
	}
	return strings.Trim(b.String(), "-")
}

// Used by load-catalog-state to compute deadlines.
var _ = strconv.Itoa // appease linter if no other strconv usage
