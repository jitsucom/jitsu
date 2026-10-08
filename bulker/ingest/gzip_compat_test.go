package main

import (
	"bytes"
	stdgzip "compress/gzip"
	"io"
	"testing"

	"github.com/jitsucom/bulker/jitsubase/jsonorder"
	"github.com/klauspost/compress/gzip"
)

// klauspost/compress/gzip replaces compress/gzip on the request-decode path
// (see the import in router_batch_handler.go). It is format-compatible but not
// byte-identical: the same input compresses to a different size, so these tests
// assert round-trip equivalence rather than equal bytes.
//
// The direction that matters is stdlib -> klauspost: clients compress with
// whatever gzip implementation they have, and we have to read it.

const batchBody = `{"writeKey":"abc123","batch":[{"type":"track","event":"Signup","properties":{"plan":"pro"}},{"type":"page","event":"Home"}]}`

type testPayload struct {
	WriteKey string           `json:"writeKey"`
	Batch    []map[string]any `json:"batch"`
}

// A client gzips its batch with the standard library; the handler must decode it.
func TestGzipStdlibWrittenIsReadable(t *testing.T) {
	var buf bytes.Buffer
	w := stdgzip.NewWriter(&buf)
	if _, err := w.Write([]byte(batchBody)); err != nil {
		t.Fatal(err)
	}
	if err := w.Close(); err != nil {
		t.Fatal(err)
	}

	r, err := gzip.NewReader(&buf)
	if err != nil {
		t.Fatalf("cannot read stdlib-written gzip: %v", err)
	}
	defer r.Close()

	// Same decode the handler performs once the body is unwrapped.
	var p testPayload
	if err := jsonorder.NewDecoder(r).Decode(&p); err != nil {
		t.Fatalf("decode failed: %v", err)
	}
	if p.WriteKey != "abc123" {
		t.Errorf("writeKey = %q, want abc123", p.WriteKey)
	}
	if len(p.Batch) != 2 {
		t.Errorf("batch = %d events, want 2", len(p.Batch))
	}
}

// And the reverse, so anything we compress stays readable by a standard reader.
func TestGzipOutputIsStandard(t *testing.T) {
	var buf bytes.Buffer
	w := gzip.NewWriter(&buf)
	if _, err := w.Write([]byte(batchBody)); err != nil {
		t.Fatal(err)
	}
	if err := w.Close(); err != nil {
		t.Fatal(err)
	}

	r, err := stdgzip.NewReader(&buf)
	if err != nil {
		t.Fatalf("stdlib cannot read our gzip: %v", err)
	}
	defer r.Close()

	got, err := io.ReadAll(r)
	if err != nil {
		t.Fatal(err)
	}
	if string(got) != batchBody {
		t.Error("round trip did not preserve the payload")
	}
}
