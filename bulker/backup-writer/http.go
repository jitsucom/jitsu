package main

import (
	"bytes"
	"crypto/subtle"
	"encoding/json"
	"errors"
	"io"
	"log"
	"net/http"
	"regexp"
)

var workspaceID = regexp.MustCompile(`^[a-z0-9][a-z0-9-]{0,48}$`)

func handler(store *spool, token string) http.Handler {
	mux := http.NewServeMux()
	admissions := make(chan struct{}, 16)
	mux.HandleFunc("POST /v1/archive/{workspace}", func(w http.ResponseWriter, r *http.Request) {
		if token == "" || subtle.ConstantTimeCompare([]byte(r.Header.Get("Authorization")), []byte("Bearer "+token)) != 1 {
			http.Error(w, "unauthorized", http.StatusUnauthorized)
			return
		}
		workspace := r.PathValue("workspace")
		if !workspaceID.MatchString(workspace) {
			http.Error(w, "invalid workspace", 400)
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
		body, err := io.ReadAll(http.MaxBytesReader(w, r.Body, maxRequestSize))
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
		if err = store.append(workspace, append(data, '\n')); err != nil {
			log.Printf("archive admission failed: %v", err)
			http.Error(w, "archive temporarily unavailable", 503)
			return
		}
		w.WriteHeader(http.StatusNoContent)
	})
	return mux
}
