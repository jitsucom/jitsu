package main

import (
	"io"
	"net/http"
	"net/http/httptest"
	"slices"
	"testing"
)

func TestBackupShadowRetry(t *testing.T) {
	var keys []string
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		keys = append(keys, r.Header.Get("Idempotency-Key"))
		b, _ := io.ReadAll(r.Body)
		if r.URL.Path != "/v1/archive/example" || r.Header.Get("Authorization") != "Bearer test" || string(b) != "body" {
			t.Error("unexpected shadow request")
		}
		if len(keys) == 1 {
			w.WriteHeader(503)
			return
		}
		w.WriteHeader(204)
	}))
	defer server.Close()
	s, err := newBackupShadow(&Config{BackupShadowWorkspace: "example", BackupShadowToken: "test", BackupShadowURL: server.URL})
	if err != nil {
		t.Fatal(err)
	}
	s.copy("other", []byte("body"))
	s.copy("example", []byte("body"))
	s.wg.Wait()
	if len(keys) != 2 || keys[0] == "" || !slices.Equal(keys[:1], keys[1:]) {
		t.Fatalf("unstable request ids: %v", keys)
	}
}
