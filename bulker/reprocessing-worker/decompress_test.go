package main

import (
	"bufio"
	"bytes"
	"compress/gzip"
	"io"
	"testing"

	"github.com/jitsucom/bulker/jitsubase/compression"
	"github.com/klauspost/compress/zstd"
)

// The job file-list arrives at a fixed path with no extension, so the format is
// detected from magic bytes. This is what lets admin switch codec without a
// coordinated deploy: whatever it writes, this reads.
func TestDecompressBlobDetectsFormat(t *testing.T) {
	payload := []byte(`[{"path":"a.ndjson.gz"},{"path":"b.ndjson.zst"}]`)

	gzipped := func() []byte {
		var b bytes.Buffer
		w := gzip.NewWriter(&b)
		_, _ = w.Write(payload)
		_ = w.Close()
		return b.Bytes()
	}()

	zstded := func() []byte {
		var b bytes.Buffer
		w, err := zstd.NewWriter(&b, zstd.WithEncoderLevel(zstd.SpeedDefault))
		if err != nil {
			t.Fatal(err)
		}
		_, _ = w.Write(payload)
		_ = w.Close()
		return b.Bytes()
	}()

	cases := map[string][]byte{
		"gzip":         gzipped,
		"zstd":         zstded,
		"uncompressed": payload,
	}
	for name, in := range cases {
		t.Run(name, func(t *testing.T) {
			got, err := decompressBlob(in)
			if err != nil {
				t.Fatalf("decompressBlob: %v", err)
			}
			if !bytes.Equal(got, payload) {
				t.Fatalf("got %q, want %q", got, payload)
			}
		})
	}
}

// A gzip blob must not be mistaken for zstd or vice versa - the magic prefixes are
// what the whole scheme rests on.
func TestMagicPrefixesAreDistinct(t *testing.T) {
	if bytes.HasPrefix(gzipMagic, zstdMagic) || bytes.HasPrefix(zstdMagic, gzipMagic) {
		t.Fatal("gzip and zstd magic bytes overlap")
	}
	if !bytes.Equal(gzipMagic, []byte{0x1f, 0x8b}) {
		t.Fatalf("gzip magic changed: %x", gzipMagic)
	}
	if !bytes.Equal(zstdMagic, []byte{0x28, 0xb5, 0x2f, 0xfd}) {
		t.Fatalf("zstd magic changed: %x", zstdMagic)
	}
}

// encodersBySuffix must cover every suffix in compression.Suffixes. Keeping the
// map here, rather than deriving it, is deliberate: adding a codec to the writers
// makes this test fail until someone adds an encoder AND confirms the reader
// handles it. That is the coupling the archive needs - a suffix the writers can
// produce but this reader cannot decode means archived events silently fail to
// replay.
var encodersBySuffix = map[string]func(*testing.T, []byte) []byte{
	compression.SuffixGzip: func(t *testing.T, p []byte) []byte {
		var b bytes.Buffer
		w := gzip.NewWriter(&b)
		if _, err := w.Write(p); err != nil {
			t.Fatal(err)
		}
		if err := w.Close(); err != nil {
			t.Fatal(err)
		}
		return b.Bytes()
	},
	compression.SuffixZstd: func(t *testing.T, p []byte) []byte {
		var b bytes.Buffer
		w, err := zstd.NewWriter(&b, zstd.WithEncoderLevel(zstd.SpeedBetterCompression))
		if err != nil {
			t.Fatal(err)
		}
		if _, err := w.Write(p); err != nil {
			t.Fatal(err)
		}
		if err := w.Close(); err != nil {
			t.Fatal(err)
		}
		return b.Bytes()
	},
}

// The archive is permanently mixed: objects written before the switch keep their
// .gz names for their full retention window, while new ones are .zst. The decoder
// is chosen by suffix, so a miss means a .zst object is fed to the line scanner as
// raw compressed bytes and replay breaks with no error anywhere.
func TestDecompressorForEveryWrittenSuffix(t *testing.T) {
	payload := []byte("{\"a\":1}\n{\"a\":2}\n{\"a\":3}\n")

	for _, suffix := range compression.Suffixes {
		encode, ok := encodersBySuffix[suffix]
		if !ok {
			t.Fatalf("no encoder in this test for suffix %q - a codec was added to "+
				"compression.Suffixes without confirming this reader decodes it", suffix)
		}
		t.Run("events.ndjson"+suffix, func(t *testing.T) {
			blob := encode(t, payload)
			r, closeFn, err := decompressorFor("events.ndjson"+suffix, bytes.NewReader(blob))
			if err != nil {
				t.Fatalf("decompressorFor: %v", err)
			}
			defer closeFn()

			got, err := io.ReadAll(r)
			if err != nil {
				t.Fatalf("read: %v", err)
			}
			if !bytes.Equal(got, payload) {
				t.Fatalf("got %q, want %q", got, payload)
			}

			n := 0
			sc := bufio.NewScanner(bytes.NewReader(got))
			for sc.Scan() {
				if len(sc.Bytes()) > 0 {
					n++
				}
			}
			if n != 3 {
				t.Fatalf("scanned %d lines, want 3", n)
			}
		})
	}
}

// Uncompressed files must pass straight through, unwrapped.
func TestDecompressorForUncompressedPassesThrough(t *testing.T) {
	payload := []byte("{\"a\":1}\n")
	in := bytes.NewReader(payload)
	got, closeFn, err := decompressorFor("events.ndjson", in)
	if err != nil {
		t.Fatal(err)
	}
	defer closeFn()
	if got != io.Reader(in) {
		t.Fatal("uncompressed path was wrapped in a decoder")
	}
	out, err := io.ReadAll(got)
	if err != nil {
		t.Fatal(err)
	}
	if !bytes.Equal(out, payload) {
		t.Fatalf("got %q, want %q", out, payload)
	}
}
