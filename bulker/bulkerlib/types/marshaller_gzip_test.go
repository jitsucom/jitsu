package types

import (
	"bytes"
	stdgzip "compress/gzip"
	"encoding/csv"
	"fmt"
	"io"
	"sync"
	"testing"

	kgzip "github.com/klauspost/compress/gzip"
	"github.com/klauspost/compress/zstd"
)

// The marshallers write batch files with klauspost/gzip at gzipLevel instead of
// compress/gzip at level 4. Two properties have to hold, and only the first is
// obvious:
//
//  1. Format compatibility. Whatever we emit must be readable by a plain stdlib
//     gzip reader, because the consumers are Snowflake/Redshift/BigQuery COPY
//     commands, ClickHouse url(), and customers reading their own S3/GCS objects.
//
//  2. The level actually applied. A library swap that silently kept level 4 would
//     emit files ~9.5% larger than before while every round-trip test still
//     passed. Byte-comparing against klauspost at gzipLevel is the only assertion
//     that catches it.
//
// The second assertion pins the test to the klauspost version in go.mod. That is
// deliberate: if a dependency bump changes the bytes we write to customer-visible
// files, the test should fail and someone should look, rather than the change
// landing unnoticed.
//
// JSONArrayMarshaller is covered here and nowhere else. Its only consumer is the
// webhook destination (implementations/api_based/webhook.go), which returns
// FileCompressionNONE, so its gzip branch cannot be reached through any
// configuration - a unit test is the only way to exercise it.

func gzipTestRows(n int) []Object {
	rows := make([]Object, 0, n)
	for i := 0; i < n; i++ {
		rows = append(rows, ObjectFromMap(map[string]any{
			"id":    fmt.Sprintf("id-%d", i),
			"event": []string{"page_view", "purchase", "login"}[i%3],
			"idx":   i,
			"note":  fmt.Sprintf("row %d - repeated filler text that compresses well", i),
		}))
	}
	return rows
}

var gzipTestHeader = []string{"id", "event", "idx", "note"}

func marshalToGzip(t *testing.T, format FileFormat) []byte {
	t.Helper()
	return marshalWith(t, format, FileCompressionGZIP)
}

func marshalWith(t *testing.T, format FileFormat, compression FileCompression) []byte {
	t.Helper()
	m, err := NewMarshaller(format, compression)
	if err != nil {
		t.Fatalf("NewMarshaller(%s): %v", format, err)
	}
	var buf bytes.Buffer
	if err := m.Init(&buf, gzipTestHeader); err != nil {
		t.Fatalf("Init(%s): %v", format, err)
	}
	if err := m.Marshal(gzipTestRows(500)...); err != nil {
		t.Fatalf("Marshal(%s): %v", format, err)
	}
	if err := m.Flush(); err != nil {
		t.Fatalf("Flush(%s): %v", format, err)
	}
	return buf.Bytes()
}

// Every compressing marshaller must produce something a stdlib gzip reader can
// read. This is the property the warehouse COPY commands depend on.
func TestMarshallersReadableByStdlibGzip(t *testing.T) {
	for _, format := range []FileFormat{FileFormatNDJSON, FileFormatNDJSONFLAT, FileFormatJSONArray, FileFormatCSV} {
		t.Run(string(format), func(t *testing.T) {
			compressed := marshalToGzip(t, format)

			r, err := stdgzip.NewReader(bytes.NewReader(compressed))
			if err != nil {
				t.Fatalf("stdlib gzip could not read %s output: %v", format, err)
			}
			plain, err := io.ReadAll(r)
			if err != nil {
				t.Fatalf("stdlib gzip read of %s output failed: %v", format, err)
			}
			if err := r.Close(); err != nil {
				t.Fatalf("stdlib gzip close on %s output: %v", format, err)
			}
			if len(plain) == 0 {
				t.Fatalf("%s: decompressed to nothing", format)
			}
			if len(compressed) >= len(plain) {
				t.Fatalf("%s: compressed %d bytes is not smaller than plain %d bytes",
					format, len(compressed), len(plain))
			}
		})
	}
}

// The decompressed payload must still be well formed - a gzip stream that reads
// back as garbage would pass the test above.
func TestMarshallersProduceWellFormedPayloads(t *testing.T) {
	decompress := func(t *testing.T, b []byte) []byte {
		t.Helper()
		r, err := stdgzip.NewReader(bytes.NewReader(b))
		if err != nil {
			t.Fatal(err)
		}
		plain, err := io.ReadAll(r)
		if err != nil {
			t.Fatal(err)
		}
		return plain
	}

	t.Run("ndjson_line_count", func(t *testing.T) {
		plain := decompress(t, marshalToGzip(t, FileFormatNDJSON))
		if got := bytes.Count(plain, []byte("\n")); got != 500 {
			t.Fatalf("expected 500 ndjson lines, got %d", got)
		}
	})

	t.Run("json_array_brackets", func(t *testing.T) {
		plain := decompress(t, marshalToGzip(t, FileFormatJSONArray))
		if len(plain) < 2 || plain[0] != '[' || plain[len(plain)-1] != ']' {
			t.Fatalf("json array output is not bracketed: starts %q ends %q",
				plain[:1], plain[len(plain)-1:])
		}
	})

	t.Run("csv_parses_with_header", func(t *testing.T) {
		plain := decompress(t, marshalToGzip(t, FileFormatCSV))
		records, err := csv.NewReader(bytes.NewReader(plain)).ReadAll()
		if err != nil {
			t.Fatalf("csv output does not parse: %v", err)
		}
		if len(records) != 501 {
			t.Fatalf("expected 1 header + 500 rows, got %d records", len(records))
		}
		if len(records[0]) != len(gzipTestHeader) {
			t.Fatalf("header width %d, expected %d", len(records[0]), len(gzipTestHeader))
		}
	})
}

// expectedGzipLevel is deliberately a literal, not a reference to gzipLevel.
// Comparing the output against the same constant the code uses would pass at any
// level - the first version of this test did exactly that and stayed green when
// gzipLevel was reverted to 4. Changing the compression level of customer-visible
// files should require editing this number and saying why.
const expectedGzipLevel = 6

func TestGzipLevelIsSix(t *testing.T) {
	if gzipLevel != expectedGzipLevel {
		t.Fatalf("gzipLevel is %d, expected %d. klauspost at level 4 emits ~9.5%% larger "+
			"files than the compress/gzip level 4 it replaced; level 6 is the equivalent. "+
			"If this change is intended, update expectedGzipLevel and explain the trade.",
			gzipLevel, expectedGzipLevel)
	}
}

// The level change is invisible to every round-trip test, so assert it directly:
// re-compressing the decompressed payload at expectedGzipLevel must reproduce the
// exact bytes the marshaller wrote. If someone reverts the level, or the writer
// stops being klauspost, this is what fails.
func TestMarshallersUseConfiguredGzipLevel(t *testing.T) {
	for _, format := range []FileFormat{FileFormatNDJSON, FileFormatJSONArray, FileFormatCSV} {
		t.Run(string(format), func(t *testing.T) {
			compressed := marshalToGzip(t, format)

			r, err := stdgzip.NewReader(bytes.NewReader(compressed))
			if err != nil {
				t.Fatal(err)
			}
			plain, err := io.ReadAll(r)
			if err != nil {
				t.Fatal(err)
			}

			var want bytes.Buffer
			w, err := kgzip.NewWriterLevel(&want, expectedGzipLevel)
			if err != nil {
				t.Fatal(err)
			}
			if _, err := w.Write(plain); err != nil {
				t.Fatal(err)
			}
			if err := w.Close(); err != nil {
				t.Fatal(err)
			}

			if !bytes.Equal(compressed, want.Bytes()) {
				var atFour bytes.Buffer
				w4, _ := kgzip.NewWriterLevel(&atFour, 4)
				_, _ = w4.Write(plain)
				_ = w4.Close()

				hint := ""
				if bytes.Equal(compressed, atFour.Bytes()) {
					hint = " - output matches klauspost level 4, so gzipLevel is not being applied"
				}
				t.Fatalf("%s: wrote %d bytes, klauspost level %d produces %d%s",
					format, len(compressed), expectedGzipLevel, want.Len(), hint)
			}
		})
	}
}

// zstd goes only where both ends are ours - S3/GCS file destinations and the event
// archive. The properties to hold are the same shape as for gzip: a standard
// decoder must read it, and the encoder must come back from the pool clean.

func TestMarshallersProduceReadableZstd(t *testing.T) {
	for _, format := range []FileFormat{FileFormatNDJSON, FileFormatNDJSONFLAT, FileFormatJSONArray, FileFormatCSV} {
		t.Run(string(format), func(t *testing.T) {
			compressed := marshalWith(t, format, FileCompressionZSTD)

			dec, err := zstd.NewReader(bytes.NewReader(compressed))
			if err != nil {
				t.Fatalf("zstd reader on %s output: %v", format, err)
			}
			defer dec.Close()
			plain, err := io.ReadAll(dec)
			if err != nil {
				t.Fatalf("zstd read of %s output failed: %v", format, err)
			}
			if len(plain) == 0 {
				t.Fatalf("%s: decompressed to nothing", format)
			}
			if len(compressed) >= len(plain) {
				t.Fatalf("%s: compressed %d bytes is not smaller than plain %d",
					format, len(compressed), len(plain))
			}
		})
	}
}

// The zstd path pools its encoders, so an encoder that is not reset properly would
// leak state from one batch into the next. Exercised against the pool directly
// rather than through a marshaller: Object is built from a Go map, whose iteration
// order is randomised, so marshaller output is not byte-reproducible across runs
// and could not distinguish a pooling bug from ordinary field reordering.
func TestZstdEncoderReuseIsClean(t *testing.T) {
	payload := bytes.Repeat([]byte("the quick brown fox jumps over the lazy dog\n"), 500)

	var first []byte
	for i := 0; i < 8; i++ {
		var buf bytes.Buffer
		w, err := zstdArchive.get(&buf)
		if err != nil {
			t.Fatalf("iteration %d: %v", i, err)
		}
		if _, err := w.Write(payload); err != nil {
			t.Fatalf("iteration %d: %v", i, err)
		}
		if err := w.Close(); err != nil {
			t.Fatalf("iteration %d: %v", i, err)
		}

		dec, err := zstd.NewReader(bytes.NewReader(buf.Bytes()))
		if err != nil {
			t.Fatalf("iteration %d: %v", i, err)
		}
		got, err := io.ReadAll(dec)
		dec.Close()
		if err != nil {
			t.Fatalf("iteration %d: %v", i, err)
		}
		if !bytes.Equal(got, payload) {
			t.Fatalf("iteration %d: decoded payload differs from input - encoder state leaked", i)
		}
		if first == nil {
			first = buf.Bytes()
		} else if !bytes.Equal(buf.Bytes(), first) {
			t.Fatalf("iteration %d: identical input produced different bytes from a pooled encoder", i)
		}
	}
}

// Closing a pooled writer must make it unusable, so a caller holding a stale
// reference cannot write into an encoder that now belongs to another batch.
func TestZstdWriterRejectsWriteAfterClose(t *testing.T) {
	var buf bytes.Buffer
	w, err := zstdArchive.get(&buf)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := w.Write([]byte("x")); err != nil {
		t.Fatal(err)
	}
	if err := w.Close(); err != nil {
		t.Fatal(err)
	}
	if _, err := w.Write([]byte("y")); err == nil {
		t.Fatal("write after close succeeded, want an error")
	}
	if err := w.Close(); err != nil {
		t.Fatalf("second Close should be a no-op, got %v", err)
	}
}

// FileExtension has to agree with what was actually written, because every reader
// picks its decompressor from the name.
func TestFileExtensionMatchesCompression(t *testing.T) {
	cases := []struct {
		format      FileFormat
		compression FileCompression
		want        string
	}{
		{FileFormatNDJSON, FileCompressionNONE, ".ndjson"},
		{FileFormatNDJSON, FileCompressionGZIP, ".ndjson.gz"},
		{FileFormatNDJSON, FileCompressionZSTD, ".ndjson.zst"},
		{FileFormatJSONArray, FileCompressionZSTD, ".json.zst"},
		{FileFormatCSV, FileCompressionZSTD, ".csv.zst"},
		{FileFormatCSV, FileCompressionGZIP, ".csv.gz"},
	}
	for _, c := range cases {
		m, err := NewMarshaller(c.format, c.compression)
		if err != nil {
			t.Fatal(err)
		}
		if got := m.FileExtension(); got != c.want {
			t.Errorf("%s/%s FileExtension() = %q, want %q", c.format, c.compression, got, c.want)
		}
	}
}

// The encoder pool exists because zstd's streaming writer is not safe for
// concurrent use and a Destination is shared across one topic consumer per
// table x mode - several batches run against it at once. That is the departure
// from the ticket's "reuse encoders per destination", so it is worth proving
// under -race rather than reasoning about.
//
// Each goroutine marshals its own batch and must get back exactly its own rows.
func TestZstdMarshallersAreSafeUnderConcurrency(t *testing.T) {
	const goroutines = 16
	const rows = 200

	var wg sync.WaitGroup
	errs := make(chan error, goroutines)

	for g := 0; g < goroutines; g++ {
		wg.Add(1)
		go func(g int) {
			defer wg.Done()

			// A payload unique to this goroutine, so cross-contamination is visible.
			objs := make([]Object, 0, rows)
			for i := 0; i < rows; i++ {
				objs = append(objs, ObjectFromMap(map[string]any{
					"goroutine": g,
					"idx":       i,
					"filler":    fmt.Sprintf("g%d-row%d-%s", g, i, "padding that compresses"),
				}))
			}

			m, err := NewMarshaller(FileFormatNDJSON, FileCompressionZSTD)
			if err != nil {
				errs <- err
				return
			}
			var buf bytes.Buffer
			if err := m.Init(&buf, nil); err != nil {
				errs <- err
				return
			}
			if err := m.Marshal(objs...); err != nil {
				errs <- err
				return
			}
			if err := m.Flush(); err != nil {
				errs <- err
				return
			}

			dec, err := zstd.NewReader(bytes.NewReader(buf.Bytes()))
			if err != nil {
				errs <- err
				return
			}
			plain, err := io.ReadAll(dec)
			dec.Close()
			if err != nil {
				errs <- err
				return
			}

			lines := bytes.Count(plain, []byte("\n"))
			if lines != rows {
				errs <- fmt.Errorf("goroutine %d: got %d lines, want %d", g, lines, rows)
				return
			}
			// Every line must belong to this goroutine.
			marker := fmt.Sprintf(`"goroutine":%d`, g)
			if got := bytes.Count(plain, []byte(marker)); got != rows {
				errs <- fmt.Errorf("goroutine %d: %d of %d rows carry its marker - encoder state crossed batches",
					g, got, rows)
				return
			}
		}(g)
	}

	wg.Wait()
	close(errs)
	for err := range errs {
		t.Error(err)
	}
}
