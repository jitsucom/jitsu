package types

import (
	"bytes"
	stdgzip "compress/gzip"
	"encoding/csv"
	"fmt"
	"io"
	"testing"

	kgzip "github.com/klauspost/compress/gzip"
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
	m, err := NewMarshaller(format, FileCompressionGZIP)
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
