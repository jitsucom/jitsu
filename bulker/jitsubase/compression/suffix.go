// Package compression holds the compression suffixes bulker writes and the
// helpers for recognising them.
//
// It exists because this codebase decides how to read a file from its name.
// Writers append a suffix; readers pick a decompressor from it; discovery filters
// and cleanup globs match on it. A codec added to the writers but missed by one of
// the matchers does not fail loudly - the file is written, then silently never
// read, never discovered, or never deleted.
//
// Keeping the suffixes and the matching in one place, in the module every reader
// and writer already imports, is what makes "add a codec" a bounded change rather
// than a hunt. Deliberately dependency-free: the codec wiring itself lives with
// the callers, where the compression libraries already are.
package compression

import (
	"path/filepath"
	"strings"
)

const (
	SuffixGzip = ".gz"
	SuffixZstd = ".zst"
)

// Suffixes lists every compression suffix bulker may write, in the order matchers
// should try them. Adding a codec means adding it here.
var Suffixes = []string{SuffixGzip, SuffixZstd}

// Suffix returns the compression suffix of name, or "" when it is uncompressed.
func Suffix(name string) string {
	for _, s := range Suffixes {
		if strings.HasSuffix(name, s) {
			return s
		}
	}
	return ""
}

// TrimSuffix removes the compression suffix from name, if it has one.
func TrimSuffix(name string) string {
	return strings.TrimSuffix(name, Suffix(name))
}

// Matches reports whether name is a data file of the given base extension, either
// uncompressed or in any compression bulker writes. Use it instead of comparing
// against a hand-written list of suffixes.
//
//	Matches("a.ndjson", ".ndjson")      -> true
//	Matches("a.ndjson.gz", ".ndjson")   -> true
//	Matches("a.ndjson.zst", ".ndjson")  -> true
//	Matches("a.csv.gz", ".ndjson")      -> false
func Matches(name, baseExt string) bool {
	return strings.HasSuffix(TrimSuffix(name), baseExt)
}

// Globs returns filepath.Glob patterns covering the uncompressed form of pattern
// and each compressed variant, so callers cannot enumerate a partial list.
func Globs(dir, pattern string) []string {
	patterns := make([]string, 0, len(Suffixes)+1)
	patterns = append(patterns, filepath.Join(dir, pattern))
	for _, s := range Suffixes {
		patterns = append(patterns, filepath.Join(dir, pattern+s))
	}
	return patterns
}
