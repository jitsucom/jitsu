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

	// counter is written by the restarted goroutine and read here.
	var counter atomic.Int32

	exec := &Execution{
		f: func() {
			counter.Add(1)
			panic("panic")
		},
		recoverHandler: GlobalRecoverHandler,
		restartTimeout: 50 * time.Millisecond,
	}
	exec.run()

	time.Sleep(200 * time.Millisecond)
	require.Greater(t, counter.Load(), int32(1), "counter must be > 1")

	time.Sleep(100 * time.Millisecond)
	require.Greater(t, counter.Load(), int32(2), "counter must be > 2")
}
