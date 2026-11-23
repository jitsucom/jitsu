package main

import (
	"bytes"
	"context"
	"errors"
	"net/http"
	"net/http/httptest"
	"os"
	"os/exec"
	"os/signal"
	"path/filepath"
	"strings"
	"sync"
	"syscall"
	"testing"
	"time"
)

const first = `{"messageId":"first","origin":{"workspaceId":"example"},"httpPayload":{"event":"signup"}}`
const second = `{"messageId":"second","origin":{"workspaceId":"example"}}`

func newSpool(t *testing.T, dir string) *spool {
	t.Helper()
	s, err := openSpool(dir, "shadow-")
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() {
		if s.active != nil {
			s.close()
		}
	})
	return s
}

func rotateAndDrain(ctx context.Context, s *spool, upload uploadObject) error {
	s.rotate()
	return drain(ctx, s, upload)
}

func post(h http.Handler, data, token string) int {
	r := httptest.NewRequest("POST", "/v1/archive/example", strings.NewReader(data))
	r.Header.Set("Authorization", "Bearer "+token)
	w := httptest.NewRecorder()
	h.ServeHTTP(w, r)
	return w.Code
}

func TestAcknowledgedBatchSurvivesKill(t *testing.T) {
	batch := first + "\n" + second
	if dir := os.Getenv("TEST_ARCHIVE_KILL_DIR"); dir != "" {
		s := newSpool(t, dir)
		if code := post(handler(s, "test"), batch, "test"); code != 204 {
			t.Fatalf("admission: %d", code)
		}
		if err := syscall.Kill(os.Getpid(), syscall.SIGKILL); err != nil {
			t.Fatal(err)
		}
		return
	}
	dir := t.TempDir()
	child := exec.Command(os.Args[0], "-test.run=^TestAcknowledgedBatchSurvivesKill$")
	child.Env = append(os.Environ(), "TEST_ARCHIVE_KILL_DIR="+dir)
	out, err := child.CombinedOutput()
	var exit *exec.ExitError
	if !errors.As(err, &exit) || exit.Sys().(syscall.WaitStatus).Signal() != syscall.SIGKILL {
		t.Fatalf("child: %v %s", err, out)
	}
	s := newSpool(t, dir)
	var original string
	if err = rotateAndDrain(t.Context(), s, func(_ context.Context, ws, key string, b []byte) error {
		if ws != "example" || string(b) != batch+"\n" {
			t.Fatalf("invalid archive %q", b)
		}
		original = key
		return errors.New("upload acknowledgement lost")
	}); err != nil || original == "" {
		t.Fatalf("missing upload: %v", err)
	}
	s.close()
	s = newSpool(t, dir)
	for range 2 {
		if code := post(handler(s, "test"), second, "test"); code != 204 {
			t.Fatalf("repeated admission: %d", code)
		}
	}
	uploads := map[string]string{}
	if err := rotateAndDrain(t.Context(), s, func(_ context.Context, ws, key string, b []byte) error { uploads[key] = string(b); return nil }); err != nil {
		t.Fatal(err)
	}
	if uploads[original] != batch+"\n" {
		t.Fatalf("restart changed sealed object: %v", uploads)
	}
	delete(uploads, original)
	if len(uploads) != 1 {
		t.Fatal("expected one more object")
	}
	for _, body := range uploads {
		if body != second+"\n"+second+"\n" {
			t.Fatal("repeated submissions must both survive")
		}
	}
	files, _ := filepath.Glob(filepath.Join(dir, "*.seg"))
	if len(files) != 0 {
		t.Fatalf("uploaded segments remain: %v", files)
	}
}

func TestTornTailAndCorruption(t *testing.T) {
	for _, test := range []struct {
		name    string
		tail    []byte
		corrupt bool
	}{
		{"damaged length", []byte{0, 0, 0, 65, 255, 255, 255, 254, 0, 0, 0, 0, 'x'}, true},
		{"short header", []byte{0, 0}, false},
		{"short payload", []byte{0, 0, 0, 9, 255, 255, 255, 246, 0, 0, 0, 0, 'x'}, false},
		{"invalid checksum", []byte{0, 0, 0, 1, 255, 255, 255, 254, 0, 0, 0, 0, 'x'}, true},
	} {
		t.Run(test.name, func(t *testing.T) {
			dir := t.TempDir()
			s := newSpool(t, dir)
			if err := s.append("example", []byte(first+"\n")); err != nil {
				t.Fatal(err)
			}
			path := filepath.Join(dir, s.active["example"].name)
			s.close()
			f, err := os.OpenFile(path, os.O_APPEND|os.O_WRONLY, 0)
			if err != nil {
				t.Fatal(err)
			}
			if _, err = f.Write(test.tail); err != nil {
				t.Fatal(err)
			}
			if err = f.Close(); err != nil {
				t.Fatal(err)
			}
			s = newSpool(t, dir)
			var body []byte
			if err = rotateAndDrain(t.Context(), s, func(_ context.Context, _, key string, b []byte) error {
				if !strings.HasSuffix(key, ".ndjson.zst") || strings.Contains(key, "_prefix_") != test.corrupt {
					t.Errorf("unexpected recovery object %q", key)
				}
				body = b
				return nil
			}); err != nil {
				t.Fatal(err)
			}
			_, err = os.Stat(path)
			if test.corrupt {
				if _, err := os.Stat(path + ".damaged"); err != nil || string(body) != first+"\n" {
					t.Fatal("corrupt segment must retain source and upload verified prefix")
				}
			} else if !errors.Is(err, os.ErrNotExist) || string(body) != first+"\n" {
				t.Fatalf("failed torn-tail recovery: %s %v", body, err)
			}
		})
	}
}

func TestRejectBeforeAck(t *testing.T) {
	dir := t.TempDir()
	s := newSpool(t, dir)
	h := handler(s, "test")
	if other, err := openSpool(dir, "shadow-"); err == nil {
		other.close()
		t.Fatal("second writer acquired spool")
	}
	for _, data := range []string{"", first + "\n{", first + "\n" + strings.Replace(second, "example", "other", 1)} {
		if code := post(h, data, "test"); code != 400 {
			t.Fatalf("invalid batch status %d", code)
		}
	}
	if code := post(h, first, "bad"); code != 401 {
		t.Fatalf("unauthorized status %d", code)
	}
	if files, _ := filepath.Glob(filepath.Join(dir, "*.seg")); len(files) != 0 {
		t.Fatal("invalid request wrote segment")
	}
	s.close()
	if code := post(h, first, "test"); code != 503 {
		t.Fatalf("unavailable spool returned %d", code)
	}
	if other, err := openSpool(dir, "wrong-"); err == nil {
		other.close()
		t.Fatal("changed bucket mapping")
	}
}

func TestConcurrentRotation(t *testing.T) {
	s := newSpool(t, t.TempDir())
	var group sync.WaitGroup
	records := 0
	upload := func(_ context.Context, _, _ string, data []byte) error {
		records += bytes.Count(data, []byte{'\n'})
		return nil
	}
	for range 8 {
		group.Go(func() {
			for range 8 {
				if err := s.append("example", []byte(first+"\n")); err != nil {
					t.Error(err)
					return
				}
			}
		})
	}
	for range 5 {
		if err := rotateAndDrain(t.Context(), s, upload); err != nil {
			t.Fatal(err)
		}
	}
	group.Wait()
	if err := rotateAndDrain(t.Context(), s, upload); err != nil {
		t.Fatal(err)
	}
	if records != 64 {
		t.Fatalf("uploaded %d records", records)
	}
}

func TestFailedAppendRetiresSegment(t *testing.T) {
	if dir := os.Getenv("TEST_ARCHIVE_LIMIT_DIR"); dir != "" {
		s := newSpool(t, dir)
		h := handler(s, "test")
		if code := post(h, first, "test"); code != 204 {
			t.Fatal(code)
		}
		// Let the next header and a prefix of its payload reach disk. A failed
		// write must return 503 and must never be followed by another frame.
		signal.Ignore(syscall.SIGXFSZ)
		var saved syscall.Rlimit
		if err := syscall.Getrlimit(syscall.RLIMIT_FSIZE, &saved); err != nil {
			t.Fatal(err)
		}
		limit := saved
		limit.Cur = uint64(frameHeaderSize*2 + len(first) + 4)
		if err := syscall.Setrlimit(syscall.RLIMIT_FSIZE, &limit); err != nil {
			t.Fatal(err)
		}
		if code := post(h, second, "test"); code != 503 {
			t.Fatalf("partial write returned %d", code)
		}
		if err := syscall.Setrlimit(syscall.RLIMIT_FSIZE, &saved); err != nil {
			t.Fatal(err)
		}
		if code := post(h, second, "test"); code != 204 {
			t.Fatalf("restored spool: %d", code)
		}
		return
	}
	dir := t.TempDir()
	child := exec.Command(os.Args[0], "-test.run=^TestFailedAppendRetiresSegment$")
	child.Env = append(os.Environ(), "TEST_ARCHIVE_LIMIT_DIR="+dir)
	if out, err := child.CombinedOutput(); err != nil {
		t.Fatalf("%v: %s", err, out)
	}
	s := newSpool(t, dir)
	got := map[string]int{}
	if err := rotateAndDrain(t.Context(), s, func(_ context.Context, _, _ string, data []byte) error { got[string(data)]++; return nil }); err != nil {
		t.Fatal(err)
	}
	if len(got) != 2 || got[first+"\n"] != 1 || got[second+"\n"] != 1 {
		t.Fatalf("recovery: %v", got)
	}
}

func TestSegmentArchiveCodec(t *testing.T) {
	const stem = "2026_11_23T12_00_00_56a493e4-4222-4094-be25-bfeb43f9a93b"
	for file, suffix := range map[string]string{".seg": ".gz", ".zst.seg": ".zst"} {
		ws, key, err := segmentObject("example." + stem + file)
		if err != nil || ws != "example" || key != "2026-11-23/backup_"+stem+".ndjson"+suffix {
			t.Fatalf("%s: %s %s %v", file, ws, key, err)
		}
	}
}

func TestAmbiguousEnvelopeRejected(t *testing.T) {
	s := newSpool(t, t.TempDir())
	h := handler(s, "test")
	for _, data := range []string{
		`{"messageId":"m","origin":{"workspaceId":"other","WorkspaceId":"example"}}`,
		`{"messageId":"m","ORIGIN":{"workspaceId":"other"},"origin":{"workspaceId":"example"}}`,
		`{"messageId":"m","origin":{"workspaceId":"other","workspaceId":"example"}}`,
		`{"messageId":"m","origin":{"workspaceId":"other"},"origin":{"workspaceId":"example"}}`,
		`{"messageId":"m","MessageId":"n","origin":{"workspaceId":"example"}}`,
		first + "{}",
	} {
		if code := post(h, first+"\n"+data, "test"); code != 400 {
			t.Fatalf("ambiguous batch returned %d", code)
		}
	}
	files, err := filepath.Glob(filepath.Join(s.dir.Name(), "*.seg"))
	if err != nil || len(files) != 0 {
		t.Fatalf("unexpected segments %v: %v", files, err)
	}
}

func TestBucketValidation(t *testing.T) {
	dir := t.TempDir()
	for _, prefix := range []string{"UPPER-", "-bad", "goog-", "bad/prefix", "bad-.", "dotted.prefix-", strings.Repeat("a", 63)} {
		if s, err := openSpool(dir, prefix); err == nil {
			s.close()
			t.Fatalf("accepted prefix %q", prefix)
		}
	}
	prefix := strings.Repeat("a", 40)
	s, err := openSpool(dir, prefix)
	if err != nil {
		t.Fatal(err)
	}
	defer s.close()
	h := handler(s, "test")
	for _, tc := range []struct {
		id     string
		status int
	}{{"ab-", 400}, {strings.Repeat("a", 24), 400}, {"google", 400}, {strings.Repeat("a", 23), 204}} {
		r := httptest.NewRequest("POST", "/v1/archive/"+tc.id, strings.NewReader(strings.ReplaceAll(first, "example", tc.id)))
		r.Header.Set("Authorization", "Bearer test")
		w := httptest.NewRecorder()
		h.ServeHTTP(w, r)
		if w.Code != tc.status {
			t.Errorf("%s: got %d want %d", tc.id, w.Code, tc.status)
		}
	}
}

func TestRotationDuringBlockedUpload(t *testing.T) {
	s := newSpool(t, t.TempDir())
	appendRecord := func(record string) {
		t.Helper()
		if err := s.append("example", []byte(record+"\n")); err != nil {
			t.Fatal(err)
		}
	}
	appendRecord("first")
	s.rotate()
	ctx, cancel := context.WithCancel(t.Context())
	done := make(chan struct{})
	ticks := make(chan time.Time)
	uploaded := make(chan string, 3)
	release := make(chan struct{})
	go func() {
		defer close(done)
		runUploader(ctx, s, func(ctx context.Context, _, _ string, b []byte) error {
			uploaded <- string(b)
			if string(b) == "first\n" {
				select {
				case <-ctx.Done():
					return ctx.Err()
				case <-release:
				}
			}
			return nil
		}, ticks)
	}()
	defer func() { cancel(); <-done }()
	wait := func() string {
		t.Helper()
		select {
		case data := <-uploaded:
			return data
		case <-time.After(5 * time.Second):
			t.Fatal("upload timed out")
			return ""
		}
	}
	tick := func() {
		t.Helper()
		select {
		case ticks <- time.Now():
		case <-time.After(5 * time.Second):
			t.Fatal("rotation blocked")
		}
	}
	if wait() != "first\n" {
		t.Fatal("missing first upload")
	}
	appendRecord("second")
	tick()
	tick() // receipt confirms the previous rotation completed
	appendRecord("third")
	tick()
	tick()
	close(release)
	got := map[string]bool{wait(): true, wait(): true}
	if !got["second\n"] || !got["third\n"] {
		t.Fatalf("expected separate segments, got %v", got)
	}
}
