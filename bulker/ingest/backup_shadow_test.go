package main

import (
	"io"
	"net/http"
	"net/http/httptest"
	"sync/atomic"
	"testing"
	"time"
)

func TestBackupShadowRetry(t *testing.T) {
	keys := make(chan string, 4)
	var attempts atomic.Int32
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		key := r.Header.Get("Idempotency-Key")
		b, _ := io.ReadAll(r.Body)
		if r.URL.Path != "/v1/archive/example" || r.Header.Get("Authorization") != "Bearer test" || string(b) != "body" {
			t.Error("unexpected shadow request")
		}
		if r.Header.Get("Idempotency-Key") == "" {
			t.Error("missing request id")
		}
		if attempts.Add(1) == 1 {
			keys <- key
			w.WriteHeader(503)
			return
		}
		keys <- key
		w.WriteHeader(204)
	}))
	defer server.Close()
	s, err := newBackupShadow(&Config{BackupShadowWorkspace: "example", BackupShadowToken: "test", BackupShadowURL: server.URL})
	if err != nil {
		t.Fatal(err)
	}
	s.copy("other", []byte("body"))
	s.copy("example", []byte("body"))
	var first string
	for range 2 {
		select {
		case key := <-keys:
			if first != "" && first != key {
				t.Fatal("retry changed request ID")
			}
			first = key
		case <-time.After(5 * time.Second):
			t.Fatal("shadow retry did not arrive")
		}
	}
}
