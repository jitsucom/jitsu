package main

import (
	"context"
	"errors"
	"fmt"
	"net"
	"testing"
	"time"

	"github.com/jackc/pgx/v5/pgconn"
	"github.com/jitsucom/bulker/jitsubase/pg"
)

// The sidecar used to panic on any Postgres failure, so a ~1 minute CNPG
// failover killed in-flight syncs (12 and 19 Sep 2026). It now retries — but
// retrying a constraint violation for two minutes would turn a clear failure
// into a slow, confusing one, so the classification is what actually matters.

func pgErr(code string) error {
	return &pgconn.PgError{Code: code, Message: "test"}
}

func TestPermanentErrorsAreNotRetried(t *testing.T) {
	for _, tc := range []struct{ code, why string }{
		{"23505", "unique violation"},
		{"23503", "foreign key violation"},
		{"42601", "syntax error"},
		{"42P01", "undefined table"},
		{"42501", "insufficient privilege"},
		{"28P01", "invalid password"},
		{"22P02", "invalid text representation"},
		{"3D000", "invalid catalog name"},
	} {
		if !isPermanentPgError(pgErr(tc.code)) {
			t.Errorf("SQLSTATE %s (%s) should be permanent — retrying it just delays the failure", tc.code, tc.why)
		}
	}
}

func TestFailoverErrorsAreRetried(t *testing.T) {
	for _, tc := range []struct{ code, why string }{
		{"25006", "read-only transaction — a demoted primary answering"},
		{"57P01", "admin shutdown — the node is draining"},
		{"57P03", "cannot connect now — still starting up"},
		{"08006", "connection failure"},
		{"08003", "connection does not exist"},
		{"40001", "serialization failure"},
		{"53300", "too many connections"},
	} {
		if isPermanentPgError(pgErr(tc.code)) {
			t.Errorf("SQLSTATE %s (%s) should be retried — this is the failover window the fix exists for", tc.code, tc.why)
		}
	}
}

// The commonest shape of the actual incident: the pool cannot dial at all, so
// there is no PgError to inspect.
func TestNonPostgresErrorsAreRetried(t *testing.T) {
	for _, err := range []error{
		errors.New("dial tcp 10.0.0.1:5432: connect: connection refused"),
		errors.New("unexpected EOF"),
		fmt.Errorf("wrapped: %w", errors.New("read: connection reset by peer")),
		nil,
	} {
		if isPermanentPgError(err) {
			t.Errorf("non-Postgres error should be retried, got permanent for: %v", err)
		}
	}
}

// errors.As must still reach the driver error through a wrap, or every
// permanent error would be retried for the full budget.
func TestClassificationSeesThroughWrapping(t *testing.T) {
	wrapped := fmt.Errorf("error updating state: %w", pgErr("23505"))
	if !isPermanentPgError(wrapped) {
		t.Fatal("wrapped PgError was not classified; errors.As is not reaching the driver error")
	}
}

// The behaviour the fix delivers: a write that fails while the primary is
// being promoted is retried and succeeds, instead of killing the sync.
// Only the recovery path is exercised — exhaustion calls s.panic, which exits
// the process.
func TestTransientWriteRecoversWithoutKillingTheSync(t *testing.T) {
	// AbstractSideCar is embedded by pointer, so it must be non-nil for s.log.
	// dbLogLevel ERROR keeps the INFO recovery line off the (nil) db pool.
	s := &ReadSideCar{AbstractSideCar: &AbstractSideCar{logLevel: "INFO", dbLogLevel: "ERROR"}}
	calls := 0
	s.retryControlPlaneWrite("test write", func() error {
		calls++
		if calls < 3 {
			return errors.New("dial tcp 10.0.0.1:5432: connect: connection refused")
		}
		return nil
	})
	if calls != 3 {
		t.Fatalf("expected the write to be retried until it succeeded, got %d attempts", calls)
	}
}

// A permanent error must fail on the first attempt rather than burning the
// whole budget. Exhaustion and permanent failure both end in s.panic, so this
// asserts the attempt count via a recovered panic rather than the exit path.
func TestPermanentWriteIsNotRetried(t *testing.T) {
	// AbstractSideCar is embedded by pointer, so it must be non-nil for s.log.
	// dbLogLevel ERROR keeps the INFO recovery line off the (nil) db pool.
	s := &ReadSideCar{AbstractSideCar: &AbstractSideCar{logLevel: "INFO", dbLogLevel: "ERROR"}}
	calls := 0
	defer func() {
		_ = recover()
		if calls != 1 {
			t.Fatalf("a permanent error should fail on the first attempt, got %d", calls)
		}
	}()
	s.retryControlPlaneWrite("test write", func() error {
		calls++
		return pgErr("23505")
	})
}

// The bound the attempt count does not give us. Each attempt is capped at two
// minutes by execTimeout, so ten slow attempts would block for twenty — far
// past the ~1 minute failover this exists for. The wall clock has to stop it.
func TestWallClockBudgetStopsSlowRetries(t *testing.T) {
	restore := retryBudget
	retryBudget = 300 * time.Millisecond
	defer func() { retryBudget = restore }()

	s := &ReadSideCar{AbstractSideCar: &AbstractSideCar{logLevel: "INFO", dbLogLevel: "ERROR"}}
	calls := 0
	started := time.Now()
	defer func() {
		_ = recover()
		if calls >= 10 {
			t.Fatalf("budget did not cut the sequence short: %d attempts ran", calls)
		}
		if elapsed := time.Since(started); elapsed > 3*time.Second {
			t.Fatalf("budget did not bound the wall clock: blocked for %s", elapsed)
		}
	}()
	s.retryControlPlaneWrite("test write", func() error {
		calls++
		time.Sleep(150 * time.Millisecond) // an attempt that hangs rather than refusing
		return errors.New("dial tcp 10.0.0.1:5432: i/o timeout")
	})
	t.Fatal("a sequence that outran its budget should have failed the sync, not returned")
}

// The budget must not be so tight that it cuts the ordinary failover case
// short: all ten attempts have to fit inside it when each one fails fast.
// 0.5+1+2+4+8+16+30+30+30 = 121.5s of backoff.
func TestBudgetAllowsTheFullBackoffSequence(t *testing.T) {
	const backoffSum = 121500 * time.Millisecond
	if retryBudget <= backoffSum {
		t.Fatalf("retryBudget %s does not cover the %s backoff sequence — fast-failing retries would be cut short", retryBudget, backoffSum)
	}
}

// SIGTERM sets s.cancelled and starts Kubernetes' termination grace period —
// 30s by default. A retry sequence that ignores it sits in a sleep until the
// pod is SIGKILLed, which is how a shutdown ends up taking longer than the
// grace period it was given.
func TestCancellationCutsRetriesShort(t *testing.T) {
	restore := retryCancelledBudget
	retryCancelledBudget = 200 * time.Millisecond
	defer func() { retryCancelledBudget = restore }()

	s := &ReadSideCar{AbstractSideCar: &AbstractSideCar{logLevel: "INFO", dbLogLevel: "ERROR"}}
	s.cancelled.Store(true)
	calls := 0
	started := time.Now()
	defer func() {
		_ = recover()
		if elapsed := time.Since(started); elapsed > 2*time.Second {
			t.Fatalf("a cancelled sidecar kept retrying for %s; the grace period is 30s", elapsed)
		}
		if calls >= 10 {
			t.Fatalf("cancellation did not cut the sequence short: %d attempts ran", calls)
		}
	}()
	s.retryControlPlaneWrite("test write", func() error {
		calls++
		return errors.New("dial tcp 10.0.0.1:5432: connect: connection refused")
	})
	t.Fatal("a cancelled sequence that ran out of budget should have failed the sync, not returned")
}

// Cancelling must not mean abandoning the write outright: the status that gets
// written during shutdown is CANCELLED itself, so a blip of a few hundred
// milliseconds still has to be ridden out.
func TestCancellationStillAllowsAShortRetry(t *testing.T) {
	s := &ReadSideCar{AbstractSideCar: &AbstractSideCar{logLevel: "INFO", dbLogLevel: "ERROR"}}
	s.cancelled.Store(true)
	calls := 0
	started := time.Now()
	s.retryControlPlaneWrite("test write", func() error {
		calls++
		if calls < 2 {
			return errors.New("dial tcp 10.0.0.1:5432: connect: connection refused")
		}
		return nil
	})
	if calls != 2 {
		t.Fatalf("a cancelled sidecar should still ride out a short blip, got %d attempts", calls)
	}
	// And it must space them. If cancellation short-circuited the wait, the ten
	// attempts would be spent in a hot loop and nothing would actually be
	// retried.
	if elapsed := time.Since(started); elapsed < 400*time.Millisecond {
		t.Fatalf("retries were not spaced while cancelled: %s for 2 attempts", elapsed)
	}
}

// The gap the cancellation check alone leaves: a SIGTERM that lands just after
// it passes would otherwise leave the sidecar asleep for the rest of the step,
// up to 30s, before anything notices.
func TestSleepIsInterruptedByCancellation(t *testing.T) {
	s := &ReadSideCar{AbstractSideCar: &AbstractSideCar{logLevel: "INFO", dbLogLevel: "ERROR"}}
	go func() {
		time.Sleep(100 * time.Millisecond)
		s.cancelled.Store(true)
	}()
	started := time.Now()
	s.sleepCancellable(5 * time.Second)
	if elapsed := time.Since(started); elapsed > time.Second {
		t.Fatalf("sleep ignored cancellation: waited %s of a 5s step", elapsed)
	}
}

// ...and it must still wait the full step when nothing cancels, or the backoff
// would collapse into a hot loop.
func TestSleepWaitsWhenNotCancelled(t *testing.T) {
	s := &ReadSideCar{AbstractSideCar: &AbstractSideCar{logLevel: "INFO", dbLogLevel: "ERROR"}}
	started := time.Now()
	s.sleepCancellable(300 * time.Millisecond)
	if elapsed := time.Since(started); elapsed < 300*time.Millisecond {
		t.Fatalf("sleep returned early without cancellation after %s", elapsed)
	}
}

// The startup pool loop runs before the deferred status writer is installed,
// so a sidecar killed in there records nothing at all. Close has to be able to
// abandon a ping in flight — the cancelled flag alone cannot do that, since
// nothing can wait on a bool.
func TestPingIsAbandonedWhenTheSidecarIsClosed(t *testing.T) {
	// A listener that accepts and then says nothing: the dial succeeds and the
	// startup handshake hangs, which is the shape of a blackholed primary.
	ln, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatalf("could not listen: %v", err)
	}
	defer ln.Close()
	go func() {
		for {
			conn, err := ln.Accept()
			if err != nil {
				return
			}
			defer conn.Close()
		}
	}()

	s := &AbstractSideCar{logLevel: "INFO", dbLogLevel: "ERROR"}
	s.shutdown, s.triggerShutdown = context.WithCancel(context.Background())

	pool, err := pg.NewPGPool(fmt.Sprintf("postgres://postgres:test@%s/test?sslmode=disable", ln.Addr().String()))
	if err != nil {
		t.Fatalf("could not build pool: %v", err)
	}
	defer pool.Close()

	go func() {
		time.Sleep(100 * time.Millisecond)
		s.Close()
	}()

	ctx, cancel := context.WithTimeout(s.shutdownCtx(), poolPingTimeout)
	defer cancel()
	started := time.Now()
	if err := pool.Ping(ctx); err == nil {
		t.Fatal("ping succeeded against a listener that never speaks")
	}
	// poolPingTimeout is 10s; without the shutdown context this would sit there
	// for all of it while the grace period runs out.
	if elapsed := time.Since(started); elapsed > 2*time.Second {
		t.Fatalf("ping ignored the shutdown and waited %s", elapsed)
	}
}

// AbstractSideCar is built as a struct literal in tests and in the spec/catalog
// paths, so the shutdown context has to tolerate never being set.
func TestShutdownContextIsNilSafe(t *testing.T) {
	s := &AbstractSideCar{}
	if s.shutdownCtx() == nil {
		t.Fatal("shutdownCtx returned nil; deriving a timeout from it would panic")
	}
	ctx, cancel := context.WithTimeout(s.shutdownCtx(), time.Second)
	defer cancel()
	if ctx.Err() != nil {
		t.Fatalf("fresh context already done: %v", ctx.Err())
	}
	s.Close() // must not panic with no context and no pipes
}
