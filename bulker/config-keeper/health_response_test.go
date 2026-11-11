package main

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/jitsucom/bulker/jitsubase/appbase"
)

func TestHealthDiagnosticsRequireAuthentication(t *testing.T) {
	router := NewRouter(&Context{config: &Config{Config: appbase.Config{RawAuthTokens: "test-token"}, Repositories: "private-repository"}})
	for _, tc := range []struct {
		path, token string
		status      int
		details     bool
	}{
		{"/health", "", http.StatusServiceUnavailable, false},
		{"/admin/health", "", http.StatusUnauthorized, false},
		{"/admin/health", "wrong-token", http.StatusUnauthorized, false},
		{"/admin/health", "test-token", http.StatusServiceUnavailable, true},
	} {
		req := httptest.NewRequest("GET", tc.path, nil)
		if tc.token != "" {
			req.Header.Set("Authorization", "Bearer "+tc.token)
		}
		w := httptest.NewRecorder()
		router.Engine().ServeHTTP(w, req)
		if w.Code != tc.status {
			t.Fatalf("%s: got %d, want %d: %s", tc.path, w.Code, tc.status, w.Body)
		}
		var body map[string]any
		if err := json.Unmarshal(w.Body.Bytes(), &body); err != nil {
			t.Fatal(err)
		}
		_, details := body["repositories"]
		if details != tc.details {
			t.Fatalf("%s: unexpected diagnostics: %s", tc.path, w.Body)
		}
		if tc.path == "/health" && (len(body) != 1 || body["status"] != "fail") {
			t.Fatalf("non-minimal health: %s", w.Body)
		}
	}
}
