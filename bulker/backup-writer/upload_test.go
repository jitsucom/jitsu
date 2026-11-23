package main

import (
	"bytes"
	"compress/gzip"
	"encoding/json"
	"io"
	"mime"
	"mime/multipart"
	"net/http"
	"net/http/httptest"
	"strconv"
	"sync"
	"testing"

	"cloud.google.com/go/storage"
	"google.golang.org/api/option"
)

// Exercise the storage SDK's upload, precondition-failure and metadata-read
// paths, including a collision whose key exists but has different contents.
func TestCreateOnlyGCSUpload(t *testing.T) {
	data := []byte(first + "\n")
	var mu sync.Mutex
	var attrs map[string]any
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		mu.Lock()
		defer mu.Unlock()
		w.Header().Set("Content-Type", "application/json")
		if r.Method == "GET" {
			json.NewEncoder(w).Encode(attrs)
			return
		}
		if r.Method != "POST" || r.URL.Query().Get("ifGenerationMatch") != "0" {
			t.Errorf("unexpected request: %s %s", r.Method, r.URL)
			w.WriteHeader(400)
			return
		}
		if attrs != nil {
			w.WriteHeader(412)
			io.WriteString(w, `{"error":{"code":412,"message":"object exists"}}`)
			return
		}
		_, params, err := mime.ParseMediaType(r.Header.Get("Content-Type"))
		if err != nil {
			t.Error(err)
			w.WriteHeader(400)
			return
		}
		parts := multipart.NewReader(r.Body, params["boundary"])
		metadata, err := parts.NextPart()
		if err != nil {
			t.Error(err)
			w.WriteHeader(400)
			return
		}
		var object map[string]any
		if err = json.NewDecoder(metadata).Decode(&object); err != nil {
			t.Error(err)
			w.WriteHeader(400)
			return
		}
		content, err := parts.NextPart()
		if err != nil {
			t.Error(err)
			w.WriteHeader(400)
			return
		}
		raw, err := io.ReadAll(content)
		if err != nil {
			t.Error(err)
			w.WriteHeader(400)
			return
		}
		gz, err := gzip.NewReader(bytes.NewReader(raw))
		if err != nil {
			t.Error(err)
			w.WriteHeader(400)
			return
		}
		unpacked, err := io.ReadAll(gz)
		if err != nil || !bytes.Equal(unpacked, data) {
			t.Errorf("invalid archive: %v", err)
		}
		object["size"] = strconv.Itoa(len(raw))
		attrs = object
		json.NewEncoder(w).Encode(attrs)
	}))
	defer server.Close()
	client, err := storage.NewClient(t.Context(), option.WithEndpoint(server.URL+"/storage/v1/"), option.WithoutAuthentication())
	if err != nil {
		t.Fatal(err)
	}
	defer client.Close()
	upload := gcsUploader(client, "archive-test-")
	for i := 0; i < 2; i++ {
		if err := upload(t.Context(), "example", "archive.ndjson.gz", data); err != nil {
			t.Fatalf("attempt %d: %v", i, err)
		}
	}
	if err := upload(t.Context(), "example", "archive.ndjson.gz", []byte(second+"\n")); err == nil {
		t.Fatal("acknowledged a conflicting object")
	}
}
