package main

import (
	"os"
	"path/filepath"
	"testing"
	"time"

	"github.com/jitsucom/bulker/jitsubase/appbase"
)

// testManager is enough of a manager to exercise local file discovery — no
// database, Kubernetes or S3 involved.
func testManager() *ReprocessingJobManager {
	return &ReprocessingJobManager{Service: appbase.NewServiceBase("test-reprocessing")}
}

func writeFile(t *testing.T, path string, modTime time.Time) {
	t.Helper()
	if err := os.MkdirAll(filepath.Dir(path), 0o755); err != nil {
		t.Fatalf("mkdir: %v", err)
	}
	if err := os.WriteFile(path, []byte(`{"messageId":"m1"}`+"\n"), 0o644); err != nil {
		t.Fatalf("write %s: %v", path, err)
	}
	if !modTime.IsZero() {
		if err := os.Chtimes(path, modTime, modTime); err != nil {
			t.Fatalf("chtimes: %v", err)
		}
	}
}

func fileNames(items []FileItem) []string {
	names := make([]string, 0, len(items))
	for _, item := range items {
		names = append(names, filepath.Base(item.Path))
	}
	return names
}

func TestListLocalFiles(t *testing.T) {
	dir := t.TempDir()
	writeFile(t, filepath.Join(dir, "failover-2026_07_30T09_00_00.ndjson"), time.Time{})
	writeFile(t, filepath.Join(dir, "failover-2026_07_30T10_00_00.ndjson.gz"), time.Time{})
	writeFile(t, filepath.Join(dir, "nested", "failover-2026_07_30T11_00_00.ndjson"), time.Time{})
	writeFile(t, filepath.Join(dir, "notes.txt"), time.Time{})
	writeFile(t, filepath.Join(dir, "archive.tar"), time.Time{})

	files, err := testManager().listLocalFiles(dir)
	if err != nil {
		t.Fatalf("listLocalFiles: %v", err)
	}

	want := []string{
		"failover-2026_07_30T09_00_00.ndjson",
		"failover-2026_07_30T10_00_00.ndjson.gz",
		"failover-2026_07_30T11_00_00.ndjson", // found recursively
	}
	if !sameIds(fileNames(files), want) {
		t.Errorf("listed %v, want %v (sorted by path, non-ndjson excluded)", fileNames(files), want)
	}
	for _, file := range files {
		if file.Size == 0 {
			t.Errorf("%s has no size", file.Path)
		}
		if file.LastModified.IsZero() {
			t.Errorf("%s has no modification time", file.Path)
		}
	}
}

func TestFilterLocalFilesByDateRange(t *testing.T) {
	dir := t.TempDir()
	// A failover file spans from the timestamp in its name until it was last
	// written, so both ends matter when deciding whether it overlaps a range.
	mk := func(name string, modTime time.Time) FileItem {
		path := filepath.Join(dir, name)
		writeFile(t, path, modTime)
		info, err := os.Stat(path)
		if err != nil {
			t.Fatalf("stat: %v", err)
		}
		return FileItem{Path: path, Size: info.Size(), LastModified: info.ModTime()}
	}
	day := func(d int, h int) time.Time { return time.Date(2026, 7, d, h, 0, 0, 0, time.UTC) }

	files := []FileItem{
		mk("failover-2026_07_28T09_00_00.ndjson", day(28, 10)), // fully before the range
		mk("failover-2026_07_29T09_00_00.ndjson", day(30, 10)), // starts before, written into the range
		mk("failover-2026_07_30T09_00_00.ndjson", day(30, 12)), // inside
		mk("failover-2026_08_02T09_00_00.ndjson", day(2, 10)),  // starts well after the range
		mk("no-timestamp-in-the-name.ndjson", day(30, 12)),     // unparseable, skipped
	}

	manager := testManager()
	filtered, err := manager.filterFilesByDateRange(nil, files, day(30, 0), day(31, 0))
	if err != nil {
		t.Fatalf("filterFilesByDateRange: %v", err)
	}
	want := []string{
		"failover-2026_07_29T09_00_00.ndjson",
		"failover-2026_07_30T09_00_00.ndjson",
	}
	if !sameIds(fileNames(filtered), want) {
		t.Errorf("filtered to %v, want %v", fileNames(filtered), want)
	}

	t.Run("no range keeps everything parseable", func(t *testing.T) {
		all, err := manager.filterFilesByDateRange(nil, files, time.Time{}, time.Time{})
		if err != nil {
			t.Fatalf("filterFilesByDateRange: %v", err)
		}
		if len(all) != len(files)-1 { // the unparseable name is always dropped
			t.Errorf("kept %d files, want %d", len(all), len(files)-1)
		}
	})
}

func TestFilterLocalFilesByList(t *testing.T) {
	dir := t.TempDir()
	first := filepath.Join(dir, "failover-2026_07_30T09_00_00.ndjson")
	second := filepath.Join(dir, "failover-2026_07_30T10_00_00.ndjson")
	third := filepath.Join(dir, "failover-2026_07_30T11_00_00.ndjson")
	for _, path := range []string{first, second, third} {
		writeFile(t, path, time.Time{})
	}
	files := []FileItem{{Path: first}, {Path: second}, {Path: third}}

	// full paths and bare names both select, whitespace is tolerated
	filtered := testManager().filterFilesByList(files, []string{
		first,
		"  failover-2026_07_30T11_00_00.ndjson  ",
		"not-in-the-listing.ndjson",
	})
	want := []string{
		"failover-2026_07_30T09_00_00.ndjson",
		"failover-2026_07_30T11_00_00.ndjson",
	}
	if !sameIds(fileNames(filtered), want) {
		t.Errorf("filtered to %v, want %v", fileNames(filtered), want)
	}
}
