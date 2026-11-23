package main

import (
	"bytes"
	"crypto/subtle"
	"database/sql"
	"encoding/json"
	"errors"
	"io"
	"log"
	"net/http"
	"regexp"
)

var workspaceID = regexp.MustCompile(`^[a-z0-9][a-z0-9-]{0,48}$`)
var requestID = regexp.MustCompile(`^[a-zA-Z0-9_-]{1,128}$`)

func handler(db *sql.DB, token, path string) http.Handler {
	mux := http.NewServeMux()
	admissions := make(chan struct{}, 16)
	mux.HandleFunc("POST /v1/archive/{workspace}", func(w http.ResponseWriter, r *http.Request) {
		if token == "" || subtle.ConstantTimeCompare([]byte(r.Header.Get("Authorization")), []byte("Bearer "+token)) != 1 {
			http.Error(w, "unauthorized", http.StatusUnauthorized)
			return
		}
		workspace, key := r.PathValue("workspace"), r.Header.Get("Idempotency-Key")
		if !workspaceID.MatchString(workspace) || !requestID.MatchString(key) {
			http.Error(w, "invalid workspace or idempotency key", 400)
			return
		}
		select {
		case admissions <- struct{}{}:
			defer func() { <-admissions }()
		default:
			http.Error(w, "writer at capacity", http.StatusServiceUnavailable)
			return
		}
		// Accept one JSON envelope or multiple newline-delimited envelopes.
		body, err := io.ReadAll(http.MaxBytesReader(w, r.Body, 8<<20))
		if err != nil {
			var limit *http.MaxBytesError
			if errors.As(err, &limit) {
				http.Error(w, "request too large", 413)
			} else {
				http.Error(w, "incomplete body", 400)
			}
			return
		}
		data := bytes.TrimSpace(body)
		for line := range bytes.SplitSeq(data, []byte{'\n'}) {
			var event struct {
				MessageID string `json:"messageId"`
				Origin    struct {
					Workspace string `json:"workspaceId"`
				} `json:"origin"`
			}
			if json.Unmarshal(line, &event) != nil || event.Origin.Workspace != workspace || event.MessageID == "" {
				http.Error(w, "invalid archive envelope", 400)
				return
			}
		}
		if err = admit(r.Context(), db, workspace, key, append(data, '\n'), checkSpace(path)); err != nil {
			if errors.Is(err, errKeyConflict) {
				http.Error(w, err.Error(), 409)
				return
			}
			log.Printf("archive admission failed: %v", err)
			http.Error(w, "archive temporarily unavailable", 503)
			return
		}
		w.WriteHeader(http.StatusNoContent)
	})
	return mux
}
