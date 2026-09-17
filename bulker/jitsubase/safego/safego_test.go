package safego

import (
	"sync/atomic"
	"testing"
	"time"

	"github.com/stretchr/testify/require"
)

func TestHandlePanicAndRestart(t *testing.T) {
	defer func() {
		if r := recover(); r != nil {
			t.Fail()
		}
	}()

	GlobalRecoverHandler = func(value any) {
	}

	// counter is written by the goroutine spawned by RunWithRestartTimeout
	// and read by this test goroutine, so it needs atomic access to satisfy
	// `go test -race`.
	var counter atomic.Int32

	// Use RunWithRestartTimeout rather than
	// RunWithRestart(...).WithRestartTimeout(50 * time.Millisecond);
	// the chained-setter pattern races with the goroutine's recover handler
	// reading restartTimeout.
	RunWithRestartTimeout(func() {
		counter.Add(1)
		panic("panic")
	}, 50*time.Millisecond)

	time.Sleep(200 * time.Millisecond)
	require.Greater(t, counter.Load(), int32(1), "counter must be > 1")

	time.Sleep(100 * time.Millisecond)
	require.Greater(t, counter.Load(), int32(2), "counter must be > 2")

	if counter.Load() == 0 {
		t.Fail()
	}
}
