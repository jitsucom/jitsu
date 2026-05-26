package main

import (
	"io"
	"net/http"
	"net/url"
	"os"
	"strconv"
	"strings"
	"time"

	"github.com/jitsucom/bulker/jitsubase/logging"
	"github.com/jitsucom/bulker/jitsubase/utils"
)

// defaultJitterMaxSeconds is used when JITTER_MAX_SECONDS is unset or
// invalid. CronJob schedules are minute-resolution, so 60s spreads any set
// of syncs sharing the same schedule deterministically across the minute
// they would otherwise all fire on. Set the env to 0 to disable.
const defaultJitterMaxSeconds = 60

// runAdmission runs the per-fire admission gates back-to-back in a single
// process so they live in one init container instead of three:
//
//  1. Jitter — sub-minute deterministic spread (hash(SYNC_ID) % JITTER_MAX_SECONDS),
//     so syncs sharing the same schedule don't slam the downstream
//     (console, Nango, DB) at the same instant. Same intent as the legacy
//     job_runner.CreateJob delay, baked into the autonomous init chain.
//  2. quota-check — fails the pod fast when the workspace's sync quota
//     is exhausted; cheap HTTP call.
//  3. lease-acquire — fails the pod if another instance of this sync is
//     already running (Lease CR held).
//
// Each helper handles its own os.Exit on terminal outcomes, so the success
// path of runAdmission ends when runLeaseAcquire exits 0.
func runAdmission() {
	runJitter()
	runQuotaCheck()
	runLeaseAcquire()
}

// runJitter sleeps for hash(SYNC_ID) % JITTER_MAX_SECONDS seconds.
// Deterministic per sync (same sleep every fire), so consecutive runs of
// the same sync stay in the same time slot. Disabled when JITTER_MAX_SECONDS
// is 0; falls back to defaultJitterMaxSeconds when unset or invalid.
func runJitter() {
	maxJitter := defaultJitterMaxSeconds
	if raw := os.Getenv("JITTER_MAX_SECONDS"); raw != "" {
		if v, err := strconv.Atoi(raw); err == nil && v >= 0 {
			maxJitter = v
		} else {
			logging.Warnf("[jitter] invalid JITTER_MAX_SECONDS=%q, using default %d", raw, defaultJitterMaxSeconds)
		}
	}
	if maxJitter == 0 {
		return
	}
	syncID := os.Getenv("SYNC_ID")
	if syncID == "" {
		// Without SYNC_ID the spread isn't deterministic, but the whole
		// point is to spread — fall back to a fixed-by-pod-name hash so
		// pods sharing a schedule still don't collide.
		syncID = os.Getenv("POD_NAME")
	}
	if syncID == "" {
		return
	}
	sleepSec := int(utils.HashStringInt(syncID)) % maxJitter
	logging.Infof("[jitter] sleeping %ds (max=%d, syncId=%s)", sleepSec, maxJitter, syncID)
	time.Sleep(time.Duration(sleepSec) * time.Second)
}

// quota-check subcommand. Run as init container in the autonomous sync Pod
// template; fails the pod fast (before any heavy init runs) when the
// workspace's sync quota is exhausted. Composed into `admission` together
// with lease-acquire.
//
// Calls the console's /api/admin/sync-quota-check endpoint, which signs an
// EE JWT and forwards the check to the billing service. We do NOT distribute
// the EE private key into every sync pod — the sidecar only needs an HTTP
// bearer (CONSOLE_TOKEN) shared with the console process.
//
// Required env: CONSOLE_URL, CONSOLE_TOKEN, WORKSPACE_ID, SYNC_ID, PACKAGE,
// PACKAGE_VERSION. Optional: TASK_ID (taken from POD_NAME field-ref by the
// CronJob template), STARTED_BY (JSON).
//
// Exit codes:
//
//	0    quota OK, proceed
//	1    quota exceeded — pod fails; console-side has already written the
//	     SKIPPED source_task row so the user sees the error
//	2    misconfiguration (missing env, malformed URL)
//
// Network errors against the console endpoint are treated as fail-open
// (exit 0) — same posture the original in-process checkQuota uses for EE
// outages: a billing service blip shouldn't paralyze every scheduled sync.
func runQuotaCheck() {
	consoleURL := strings.TrimRight(os.Getenv("CONSOLE_URL"), "/")
	consoleToken := os.Getenv("CONSOLE_TOKEN")
	if consoleURL == "" || consoleToken == "" {
		logging.Warnf("[quota-check] CONSOLE_URL/CONSOLE_TOKEN unset; skipping quota check (fail-open)")
		return
	}
	workspaceID := requireEnv("WORKSPACE_ID")
	syncID := requireEnv("SYNC_ID")
	pkg := requireEnv("PACKAGE")
	pkgVer := requireEnv("PACKAGE_VERSION")
	taskID := os.Getenv("TASK_ID")
	if taskID == "" {
		// POD_NAME-as-TASK_ID is set in cronjob_controller.go for the main
		// sidecar but not necessarily here; fall back to POD_NAME.
		taskID = os.Getenv("POD_NAME")
	}
	startedBy := os.Getenv("STARTED_BY")
	if startedBy == "" {
		startedBy = `{"trigger":"scheduled"}`
	}

	q := url.Values{}
	q.Set("workspaceId", workspaceID)
	q.Set("syncId", syncID)
	q.Set("package", pkg)
	q.Set("version", pkgVer)
	if taskID != "" {
		q.Set("taskId", taskID)
	}
	q.Set("startedBy", startedBy)

	endpoint := consoleURL + "/api/admin/sync-quota-check?" + q.Encode()
	req, err := http.NewRequest(http.MethodGet, endpoint, nil)
	if err != nil {
		logging.Errorf("[quota-check] build request: %v", err)
		os.Exit(2)
	}
	req.Header.Set("Authorization", "Bearer "+consoleToken)

	client := &http.Client{Timeout: 15 * time.Second}
	resp, err := client.Do(req)
	if err != nil {
		// Fail-open on transport errors. If console is unreachable, scheduled
		// syncs must still get a chance to run (the quota system is advisory
		// for billing, not a hard correctness gate).
		logging.Warnf("[quota-check] console unreachable: %v — proceeding (fail-open)", err)
		return
	}
	defer resp.Body.Close()
	body, _ := io.ReadAll(resp.Body)

	switch {
	case resp.StatusCode == http.StatusOK:
		logging.Infof("[quota-check] passed for workspace=%s sync=%s", workspaceID, syncID)
		return
	case resp.StatusCode == http.StatusForbidden:
		logging.Errorf("[quota-check] quota exceeded: %s", strings.TrimSpace(string(body)))
		os.Exit(1)
	case resp.StatusCode == http.StatusUnauthorized:
		// Config bug — bearer mismatch between syncctl and console. Fail
		// loudly rather than fail-open, otherwise we'd silently skip every
		// quota check forever.
		logging.Errorf("[quota-check] console rejected our bearer (401): %s", strings.TrimSpace(string(body)))
		os.Exit(2)
	default:
		logging.Warnf("[quota-check] unexpected status %d from console: %s — proceeding (fail-open)",
			resp.StatusCode, strings.TrimSpace(string(body)))
	}
}
