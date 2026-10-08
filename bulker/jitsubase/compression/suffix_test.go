package compression

import (
	"os"
	"path/filepath"
	"testing"
)

func TestSuffix(t *testing.T) {
	cases := map[string]string{
		"a.ndjson":       "",
		"a.ndjson.gz":    SuffixGzip,
		"a.ndjson.zst":   SuffixZstd,
		"a.csv.gz":       SuffixGzip,
		"a.json.zst":     SuffixZstd,
		"nosuffix":       "",
		"trailing.gz.gz": SuffixGzip,
	}
	for name, want := range cases {
		if got := Suffix(name); got != want {
			t.Errorf("Suffix(%q) = %q, want %q", name, got, want)
		}
	}
}

func TestMatches(t *testing.T) {
	// A data file is the base extension, optionally followed by any compression
	// suffix we write. Callers used to spell this out as a hand-written list, which
	// is how .zst files became invisible to discovery.
	for _, name := range []string{"a.ndjson", "a.ndjson.gz", "a.ndjson.zst"} {
		if !Matches(name, ".ndjson") {
			t.Errorf("Matches(%q, \".ndjson\") = false, want true", name)
		}
	}
	for _, name := range []string{"a.csv", "a.csv.gz", "a.json.zst", "a.ndjsonx"} {
		if Matches(name, ".ndjson") {
			t.Errorf("Matches(%q, \".ndjson\") = true, want false", name)
		}
	}
}

// Every compression we can write must be matchable and globbable. This is the
// test that fails when a codec is added to Suffixes but a matcher is not updated -
// or, more importantly, when a codec is added elsewhere and never added here.
func TestEverySuffixIsRecognised(t *testing.T) {
	for _, s := range Suffixes {
		name := "file.ndjson" + s
		if got := Suffix(name); got != s {
			t.Errorf("Suffix(%q) = %q, want %q", name, got, s)
		}
		if !Matches(name, ".ndjson") {
			t.Errorf("Matches(%q, \".ndjson\") = false, want true", name)
		}
		if TrimSuffix(name) != "file.ndjson" {
			t.Errorf("TrimSuffix(%q) = %q, want %q", name, TrimSuffix(name), "file.ndjson")
		}
	}
}

func TestGlobsCoverEverySuffix(t *testing.T) {
	got := Globs("/tmp/fo", "*.ndjson")
	want := []string{filepath.Join("/tmp/fo", "*.ndjson")}
	for _, s := range Suffixes {
		want = append(want, filepath.Join("/tmp/fo", "*.ndjson"+s))
	}
	if len(got) != len(want) {
		t.Fatalf("Globs returned %d patterns, want %d: %v", len(got), len(want), got)
	}
	for i := range want {
		if got[i] != want[i] {
			t.Errorf("Globs[%d] = %q, want %q", i, got[i], want[i])
		}
	}
}

// Globs is used by failover-log cleanup, where a pattern that fails to match is
// not a visible error - the files are simply never deleted and local disk grows
// without bound. So assert against a real filesystem, not just the pattern
// strings: filepath.Glob has its own escaping rules and a pattern that looks
// right can still match nothing.
func TestGlobsFindRealFilesForEverySuffix(t *testing.T) {
	dir := t.TempDir()

	var want []string
	for _, name := range []string{"kafka_failover_a.ndjson"} {
		want = append(want, name)
		for _, s := range Suffixes {
			want = append(want, name+s)
		}
	}
	// Files that must NOT be picked up.
	decoys := []string{"kafka_failover_a.csv.gz", "notes.txt", "kafka_failover_a.ndjsonx"}

	for _, name := range append(append([]string{}, want...), decoys...) {
		if err := os.WriteFile(filepath.Join(dir, name), []byte("x"), 0o600); err != nil {
			t.Fatal(err)
		}
	}

	found := map[string]bool{}
	for _, pattern := range Globs(dir, "*.ndjson") {
		matches, err := filepath.Glob(pattern)
		if err != nil {
			t.Fatalf("Glob(%q): %v", pattern, err)
		}
		for _, m := range matches {
			found[filepath.Base(m)] = true
		}
	}

	for _, name := range want {
		if !found[name] {
			t.Errorf("%q was not matched by any pattern - files like this would never be cleaned up", name)
		}
	}
	for _, name := range decoys {
		if found[name] {
			t.Errorf("%q was matched but should not have been", name)
		}
	}
}

// The admin failover reprocessor discovers files by matching object keys, which
// carry a prefix. A suffix miss there means the file is silently never picked up
// for reprocessing.
func TestMatchesOnRealisticObjectKeys(t *testing.T) {
	keys := map[string]bool{
		"workspace-1/kafka_failover_2026_09_10T12_00_00.ndjson":     true,
		"workspace-1/kafka_failover_2026_09_10T12_00_00.ndjson.gz":  true,
		"workspace-1/kafka_failover_2026_09_10T12_00_00.ndjson.zst": true,
		"workspace-1/events_2026_09_10T12_00_00.csv.gz":             false,
		"workspace-1/events_2026_09_10T12_00_00.json.zst":           false,
		"kafka_failover.ndjson.zst":                                 true,
	}
	for key, want := range keys {
		if got := Matches(key, ".ndjson"); got != want {
			t.Errorf("Matches(%q, \".ndjson\") = %v, want %v", key, got, want)
		}
	}
}
