package appbase

import (
	"fmt"
	"io"
	"strings"
	"sync/atomic"
	"testing"

	log "github.com/sirupsen/logrus"
)

type testData struct {
	data atomic.Pointer[string]
}

func (t *testData) Init(reader io.Reader, tag any) error {
	b, err := io.ReadAll(reader)
	if err != nil {
		return err
	}
	s := string(b)
	t.data.Store(&s)
	return nil
}

func (t *testData) GetData() *string { return t.data.Load() }

func (t *testData) Store(w io.Writer) error {
	d := t.data.Load()
	if d == nil {
		return fmt.Errorf("no data")
	}
	_, err := w.Write([]byte(*d))
	return err
}

// captureExit swallows the process exit that logging.Fatalf performs and reports
// whether it was reached.
func captureExit(t *testing.T) *atomic.Bool {
	t.Helper()
	var exited atomic.Bool
	logger := log.StandardLogger()
	prevExit, prevOut := logger.ExitFunc, logger.Out
	logger.ExitFunc = func(int) { exited.Store(true) }
	logger.SetOutput(io.Discard)
	t.Cleanup(func() {
		logger.ExitFunc = prevExit
		logger.SetOutput(prevOut)
	})
	return &exited
}

// failingSource fails until it is switched on, then serves payload.
type failingSource struct {
	ok      atomic.Bool
	payload string
}

func (f *failingSource) load(tag any) (io.ReadCloser, any, bool, error) {
	if !f.ok.Load() {
		return nil, nil, false, fmt.Errorf("datasource is down")
	}
	return io.NopCloser(strings.NewReader(f.payload)), "tag", true, nil
}

// A repository that has never loaded must keep waiting rather than kill the
// process - config-keeper serves several repositories from one process, so an
// exit over one unreachable datasource takes down the ones that are healthy.
func TestWaitForDataDoesNotExit(t *testing.T) {
	exited := captureExit(t)
	src := &failingSource{payload: "hello"}
	// cacheDir "" is the harshest case: no datasource and nothing cached
	r := NewAbstractRepository[string]("test-wait", &testData{}, src.load, 1, 1, "", WaitForData)

	r.refresh(false)

	if exited.Load() {
		t.Fatal("WaitForData repository exited the process on a failed initial load")
	}
	if r.Loaded() {
		t.Error("Loaded() must stay false while there is no data")
	}
	if r.GetData() != nil {
		t.Error("GetData() must be nil before the first successful load")
	}

	// ...and it must pick the data up once the datasource comes back
	src.ok.Store(true)
	r.refresh(false)

	if !r.Loaded() {
		t.Fatal("repository did not load after the datasource recovered")
	}
	if got := r.GetData(); got == nil || *got != "hello" {
		t.Errorf("got %v, want \"hello\"", got)
	}
	if exited.Load() {
		t.Error("process exited during recovery")
	}
}

// The default stays fail-fast: a service that would otherwise serve traffic
// against empty configuration should not come up at all.
func TestExitOnNoDataStillExits(t *testing.T) {
	exited := captureExit(t)
	src := &failingSource{payload: "hello"}
	r := NewAbstractRepository[string]("test-exit", &testData{}, src.load, 1, 1, "", ExitOnNoData)

	r.refresh(false)

	if !exited.Load() {
		t.Error("ExitOnNoData repository did not exit on a failed initial load")
	}
}

// Once loaded, a failing refresh must never reach the no-data path under either
// policy: the previous good data keeps being served.
func TestLoadedRepositoryKeepsServingAfterRefreshFailure(t *testing.T) {
	for _, policy := range []struct {
		name  string
		value NoDataPolicy
	}{{"WaitForData", WaitForData}, {"ExitOnNoData", ExitOnNoData}} {
		t.Run(policy.name, func(t *testing.T) {
			exited := captureExit(t)
			src := &failingSource{payload: "hello"}
			src.ok.Store(true)
			r := NewAbstractRepository[string]("test-"+policy.name, &testData{}, src.load, 1, 1, "", policy.value)

			r.refresh(false)
			if !r.Loaded() {
				t.Fatal("setup: repository did not load")
			}

			src.ok.Store(false)
			r.refresh(false)

			if exited.Load() {
				t.Error("a refresh failure after a successful load must not exit")
			}
			if got := r.GetData(); got == nil || *got != "hello" {
				t.Errorf("previous data was lost: got %v", got)
			}
		})
	}
}
