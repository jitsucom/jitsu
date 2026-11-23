package main

import (
	"bytes"
	"compress/gzip"
	"encoding/base64"
	"encoding/binary"
	"encoding/json"
	"hash/crc32"
	"io"
	"mime"
	"mime/multipart"
	"net/http"
	"net/http/httptest"
	"strconv"
	"sync"
	"testing"

	"cloud.google.com/go/storage"
	"github.com/klauspost/compress/zstd"
	"google.golang.org/api/option"
)

// Exercise the storage SDK's upload, precondition-failure and metadata-read
// paths, including a collision whose key exists but has different contents.
func TestCreateOnlyGCSUpload(t *testing.T) {
	for _, codec := range []string{"zst", "gz"} {
		t.Run(codec, func(t *testing.T) { testCreateOnlyUpload(t, codec) })
	}
}

func testCreateOnlyUpload(t *testing.T, codec string) {
	data := []byte(first + "\n")
	var mu sync.Mutex
	var attrs map[string]any
	var stored []byte
	var downloads int
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		mu.Lock()
		defer mu.Unlock()
		w.Header().Set("Content-Type", "application/json")
		if r.Method == "GET" && r.URL.Path == "/archive-test-example/archive.ndjson."+codec {
			if r.Header.Get("X-Goog-If-Generation-Match") != "42" {
				t.Error("media read missing live generation precondition")
			}
			downloads++
			w.Header().Set("Content-Type", "application/octet-stream")
			w.Write(stored)
			return
		}
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
		var unpacked []byte
		if codec == "zst" {
			if object["contentType"] != "application/zstd" {
				t.Error("wrong zstd content type")
			}
			decoder, openErr := zstd.NewReader(nil)
			if openErr != nil {
				t.Error(openErr)
				w.WriteHeader(400)
				return
			}
			defer decoder.Close()
			unpacked, err = decoder.DecodeAll(raw, nil)
		} else {
			if object["contentType"] != "application/gzip" {
				t.Error("wrong gzip content type")
			}
			gz, openErr := gzip.NewReader(bytes.NewReader(raw))
			if openErr != nil {
				t.Error(openErr)
				w.WriteHeader(400)
				return
			}
			defer gz.Close()
			unpacked, err = io.ReadAll(gz)
		}
		if err != nil || !bytes.Equal(unpacked, data) {
			t.Errorf("invalid archive: %v", err)
		}
		object["size"] = strconv.Itoa(len(raw))
		object["generation"] = "42"
		stored = raw
		attrs = object
		json.NewEncoder(w).Encode(attrs)
	}))
	defer server.Close()
	client, err := storage.NewClient(t.Context(), option.WithEndpoint(server.URL+"/storage/v1/"), option.WithoutAuthentication())
	if err != nil {
		t.Fatal(err)
	}
	defer client.Close()
	upload, err := newGCSUploader(client, "archive-test-")
	if err != nil {
		t.Fatal(err)
	}
	retry := func() error { return upload(t.Context(), "example", "archive.ndjson."+codec, data) }
	for range 2 {
		if err := retry(); err != nil {
			t.Fatal(err)
		}
	}
	mu.Lock()
	reads := downloads
	mu.Unlock()
	if reads != 0 {
		t.Fatal("identical retry downloaded the object")
	}

	// Model a restore that preserves the custom metadata. GCS computes a
	// new CRC32C and size for the bytes actually stored.
	replaceBytes := func(payload []byte) {
		mu.Lock()
		defer mu.Unlock()
		stored = payload
		attrs["size"] = strconv.Itoa(len(stored))
		attrs["crc32c"] = base64.StdEncoding.EncodeToString(binary.BigEndian.AppendUint32(nil, crc32.Checksum(stored, crcTable)))
	}
	encode := func(plain []byte) []byte {
		if codec == "zst" {
			enc, err := zstd.NewWriter(nil, zstd.WithEncoderCRC(false))
			if err != nil {
				t.Fatal(err)
			}
			defer enc.Close()
			return enc.EncodeAll(plain, nil)
		}
		var out bytes.Buffer
		gz := gzip.NewWriter(&out)
		gz.Name = "restored"
		if _, err := gz.Write(plain); err != nil {
			t.Fatal(err)
		}
		if err := gz.Close(); err != nil {
			t.Fatal(err)
		}
		return out.Bytes()
	}
	replaceBytes(encode(data))
	if err := retry(); err != nil {
		t.Fatalf("equivalent archive: %v", err)
	}
	mu.Lock()
	reads = downloads
	mu.Unlock()
	if reads != 1 {
		t.Fatalf("equivalent archive triggered %d downloads", reads)
	}
	changed := bytes.Clone(data)
	changed[0] = 'X'
	replaceBytes(encode(changed))
	if err := retry(); err == nil {
		t.Fatal("accepted different content with the original metadata")
	}
	replaceBytes(encode(append(bytes.Clone(data), 'X')))
	if err := retry(); err == nil {
		t.Fatal("accepted extra content")
	}
	replaceBytes([]byte("damaged"))
	if err := retry(); err == nil {
		t.Fatal("accepted damaged archive")
	}
	if err := upload(t.Context(), "example", "archive.ndjson."+codec, []byte(second+"\n")); err == nil {
		t.Fatal("acknowledged a conflicting object")
	}
}
