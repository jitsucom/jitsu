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
	"strings"
)

var workspaceID = regexp.MustCompile(`^[a-z0-9]([a-z0-9-]{0,47}[a-z0-9])?$`)

// Read the routing fields by exact name. Reject duplicates and case aliases
// even if a JSON reader would silently choose one of their values.
func archiveFields(data []byte, names ...string) (map[string]json.RawMessage, bool) {
	dec := json.NewDecoder(bytes.NewReader(data))
	first, err := dec.Token()
	if err != nil || first != json.Delim('{') {
		return nil, false
	}
	fields := make(map[string]json.RawMessage, len(names))
	for dec.More() {
		key, err := dec.Token()
		if err != nil {
			return nil, false
		}
		var value json.RawMessage
		if dec.Decode(&value) != nil {
			return nil, false
		}
		for _, name := range names {
			if strings.EqualFold(key.(string), name) {
				if key != name || fields[name] != nil {
					return nil, false
				}
				fields[name] = value
			}
		}
	}
	end, err := dec.Token()
	if err != nil || end != json.Delim('}') {
		return nil, false
	}
	_, err = dec.Token()
	return fields, err == io.EOF && len(fields) == len(names)
}

func validEnvelope(data []byte, workspace string) bool {
	envelope, ok := archiveFields(data, "messageId", "origin")
	if !ok {
		return false
	}
	origin, ok := archiveFields(envelope["origin"], "workspaceId")
	var messageID, workspaceID string
	return ok && json.Unmarshal(envelope["messageId"], &messageID) == nil && messageID != "" &&
		json.Unmarshal(origin["workspaceId"], &workspaceID) == nil && workspaceID == workspace
}

func handler(store *spool, token string) http.Handler {
	mux := http.NewServeMux()
	admissions := make(chan struct{}, 16)
	mux.HandleFunc("POST /v1/archive/{workspace}", func(w http.ResponseWriter, r *http.Request) {
		if token == "" || subtle.ConstantTimeCompare([]byte(r.Header.Get("Authorization")), []byte("Bearer "+token)) != 1 {
			http.Error(w, "unauthorized", http.StatusUnauthorized)
			return
		}
		workspace := r.PathValue("workspace")
		if !workspaceID.MatchString(workspace) || !validBucketName(store.prefix+workspace) {
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
			if !validEnvelope(line, workspace) {
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
