package main

import (
	"bytes"
	"context"
	"database/sql"
	"errors"
	"fmt"
	"net/http"
	"net/http/httptest"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"syscall"
	"testing"
)

const first = `{"messageId":"first","origin":{"workspaceId":"example"},"httpPayload":{"event":"signup"}}`
const second = `{"messageId":"second","origin":{"workspaceId":"example"}}`

func database(t *testing.T, path string) *sql.DB {
	t.Helper()
	db, err := openSpool(path)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { db.Close() })
	return db
}
func post(h http.Handler, key, data, token string) int {
	r := httptest.NewRequest("POST", "/v1/archive/example", strings.NewReader(data))
	r.Header.Set("Authorization", "Bearer "+token)
	r.Header.Set("Idempotency-Key", key)
	w := httptest.NewRecorder()
	h.ServeHTTP(w, r)
	return w.Code
}

func TestAcknowledgedBatchSurvivesKill(t *testing.T) {
	if path := os.Getenv("TEST_ARCHIVE_KILL_DB"); path != "" {
		db := database(t, path)
		if code := post(handler(db, "test"), "one", first+"\n"+second, "test"); code != 204 {
			t.Fatalf("admission: %d", code)
		}
		// Kill without running shutdown, SQLite Close, or upload.
		if err := syscall.Kill(os.Getpid(), syscall.SIGKILL); err != nil {
			t.Fatal(err)
		}
		return
	}
	path := filepath.Join(t.TempDir(), "spool.db")
	child := exec.Command(os.Args[0], "-test.run=^TestAcknowledgedBatchSurvivesKill$")
	child.Env = append(os.Environ(), "TEST_ARCHIVE_KILL_DB="+path)
	out, err := child.CombinedOutput()
	var exit *exec.ExitError
	if !errors.As(err, &exit) || exit.Sys().(syscall.WaitStatus).Signal() != syscall.SIGKILL {
		t.Fatalf("child: %v %s", err, out)
	}
	db := database(t, path)
	h := handler(db, "test")
	batch := first + "\n" + second + "\n"
	if code := post(h, "one", batch, "test"); code != 204 {
		t.Fatalf("retry: %d", code)
	}
	if code := post(h, "one", first, "test"); code != 409 {
		t.Fatalf("key conflict: %d", code)
	}
	name, data, err := seal(t.Context(), db, "example")
	if err != nil || string(data) != batch {
		t.Fatalf("recovery: %s %v", data, err)
	}
	// The object committed remotely, but the local completion transaction did
	// not run. A restart and an intervening new admission must not change it.
	if err = db.Close(); err != nil {
		t.Fatal(err)
	}
	db = database(t, path)
	h = handler(db, "test")
	if code := post(h, "two", second, "test"); code != 204 {
		t.Fatalf("new request: %d", code)
	}
	_, err = flush(t.Context(), db, "example", func(_ context.Context, ws, key string, b []byte) error {
		if ws != "example" || key != name || !bytes.Equal(b, data) {
			t.Fatalf("retry changed sealed object: %s %s", ws, key)
		}
		return errors.New("GCS unavailable")
	})
	if err == nil {
		t.Fatal("failed upload reported success")
	}
	_, err = flush(t.Context(), db, "example", func(_ context.Context, ws, key string, b []byte) error {
		if key != name || !bytes.Equal(b, data) {
			t.Fatal("upload retry changed content")
		}
		return nil
	})
	if err != nil {
		t.Fatal(err)
	}
	if code := post(h, "one", batch, "test"); code != 204 {
		t.Fatalf("late retry: %d", code)
	}
	next, pending, err := seal(t.Context(), db, "example")
	if err != nil || next == name || string(pending) != second+"\n" {
		t.Fatalf("next object: %s %v", pending, err)
	}
}

func TestRejectBeforeAck(t *testing.T) {
	db := database(t, filepath.Join(t.TempDir(), "spool.db"))
	h := handler(db, "test")
	for _, data := range []string{"", first + "\n{", first + "\n" + strings.Replace(second, "example", "other", 1)} {
		if code := post(h, "key", data, "test"); code != 400 {
			t.Fatalf("invalid batch status %d", code)
		}
	}
	if code := post(h, "key", first, "bad"); code != 401 {
		t.Fatalf("unauthorized status %d", code)
	}
	if _, _, err := seal(t.Context(), db, "example"); !errors.Is(err, sql.ErrNoRows) {
		t.Fatalf("partial admission: %v", err)
	}
	// Exhaust SQLite's page budget to exercise a real SQLITE_FULL on commit.
	var pages int
	if err := db.QueryRow("PRAGMA page_count").Scan(&pages); err != nil {
		t.Fatal(err)
	}
	if _, err := db.Exec(fmt.Sprintf("PRAGMA max_page_count=%d", pages)); err != nil {
		t.Fatal(err)
	}
	oversized := strings.Replace(first, "signup", strings.Repeat("a", 65536), 1)
	if code := post(h, "full", oversized, "test"); code != 503 {
		t.Fatalf("disk full status %d", code)
	}
	if _, _, err := seal(t.Context(), db, "example"); !errors.Is(err, sql.ErrNoRows) {
		t.Fatalf("disk full committed data: %v", err)
	}
}
