package main

import (
	"errors"
	"fmt"
	"testing"

	"github.com/jackc/pgx/v5/pgconn"
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
