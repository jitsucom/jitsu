package main

import (
	"context"
	"errors"
	"fmt"
	"os/exec"
	"strings"
	"testing"
	"time"

	"github.com/jitsucom/bulker/jitsubase/pg"
)

// The unit tests drive the classification and the retry loop with fabricated
// errors. This one uses a real Postgres and really takes it away mid-flight,
// which is the actual thing the fix claims to survive: on 12 and 19 Sep 2026 a
// node replacement moved the CNPG primary and the sidecar panicked instead of
// waiting.
//
// Drives docker directly rather than pulling testcontainers into this module
// for a single test. Skips when docker is unavailable.

func dockerAvailable() bool {
	return exec.Command("docker", "info").Run() == nil
}

func dockerRun(t *testing.T, args ...string) string {
	t.Helper()
	out, err := exec.Command("docker", args...).CombinedOutput()
	if err != nil {
		t.Fatalf("docker %s: %v\n%s", strings.Join(args, " "), err, out)
	}
	return strings.TrimSpace(string(out))
}

func startPostgres(t *testing.T) (dsn, name string) {
	t.Helper()
	name = fmt.Sprintf("sidecar-retry-test-%d", time.Now().UnixNano())
	// A fixed host port, not -P: docker assigns a NEW random port when a
	// container created with -P is restarted, so the DSN would point at a dead
	// port for the rest of the test and the retry could never succeed.
	port := 45000 + int(time.Now().UnixNano()%2000)
	dockerRun(t, "run", "-d", "--name", name,
		"-e", "POSTGRES_PASSWORD=test", "-e", "POSTGRES_DB=test",
		"-p", fmt.Sprintf("%d:5432", port), "postgres:16-alpine")
	t.Cleanup(func() { _ = exec.Command("docker", "rm", "-f", name).Run() })

	dsn = fmt.Sprintf("postgres://postgres:test@localhost:%d/test?sslmode=disable", port)

	// wait for it to accept connections
	deadline := time.Now().Add(60 * time.Second)
	for time.Now().Before(deadline) {
		if exec.Command("docker", "exec", name, "pg_isready", "-U", "postgres").Run() == nil {
			return dsn, name
		}
		time.Sleep(500 * time.Millisecond)
	}
	t.Fatal("postgres did not become ready in 60s")
	return "", ""
}

func TestSurvivesPostgresDisappearingMidFlight(t *testing.T) {
	if testing.Short() {
		t.Skip("starts a real postgres and stops it mid-flight")
	}
	if !dockerAvailable() {
		t.Skip("docker not available")
	}
	dsn, name := startPostgres(t)

	pool, err := pg.NewPGPool(dsn, pg.WithStatementTimeout(10*time.Second))
	if err != nil {
		t.Fatalf("could not build pool: %v", err)
	}
	defer pool.Close()

	write := func() error {
		ctx, cancel := context.WithTimeout(context.Background(), 3*time.Second)
		defer cancel()
		_, err := pool.Exec(ctx, "select 1")
		return err
	}
	if err := write(); err != nil {
		t.Fatalf("baseline write failed: %v", err)
	}

	// Take the database away, exactly as a node replacement does.
	dockerRun(t, "stop", name)
	if err := write(); err == nil {
		t.Fatal("expected the write to fail while postgres is stopped")
	}

	// Bring it back while the sidecar is mid-retry.
	go func() {
		time.Sleep(2 * time.Second)
		_ = exec.Command("docker", "start", name).Run()
	}()

	s := &ReadSideCar{AbstractSideCar: &AbstractSideCar{logLevel: "INFO", dbLogLevel: "ERROR"}}
	done := make(chan struct{})
	start := time.Now()
	go func() {
		defer close(done)
		s.retryControlPlaneWrite("state write during failover", write)
	}()

	select {
	case <-done:
		t.Logf("recovered after %s", time.Since(start).Round(100*time.Millisecond))
	case <-time.After(180 * time.Second):
		t.Fatal("retryControlPlaneWrite never returned — the sync would be stuck, not recovered")
	}

	if err := write(); err != nil {
		t.Fatalf("pool did not recover after postgres returned: %v", err)
	}
}

// The counterpart: before the fix, one failure was fatal. This asserts a write
// against a database that never comes back still ends, rather than hanging.
func TestGivesUpWhenPostgresNeverReturns(t *testing.T) {
	if testing.Short() {
		t.Skip("exhausts the full retry budget, ~2 minutes")
	}
	if !dockerAvailable() {
		t.Skip("docker not available")
	}
	dsn, name := startPostgres(t)
	pool, err := pg.NewPGPool(dsn, pg.WithStatementTimeout(5*time.Second))
	if err != nil {
		t.Fatalf("could not build pool: %v", err)
	}
	defer pool.Close()
	dockerRun(t, "stop", name)

	attempts := 0
	op := func() error {
		attempts++
		ctx, cancel := context.WithTimeout(context.Background(), 2*time.Second)
		defer cancel()
		_, e := pool.Exec(ctx, "select 1")
		if e == nil {
			return errors.New("unexpected success")
		}
		return e
	}

	defer func() {
		if recover() == nil {
			t.Fatal("expected the budget to be exhausted and the sync to fail")
		}
		if attempts != 10 {
			t.Fatalf("expected the full budget of 10 attempts, got %d", attempts)
		}
	}()
	s := &ReadSideCar{AbstractSideCar: &AbstractSideCar{logLevel: "INFO", dbLogLevel: "ERROR"}}
	s.retryControlPlaneWrite("state write", op)
}
