package safego

import (
	"github.com/stretchr/testify/require"
	"testing"
	"time"
)

func TestHandlePanicAndRestart(t *testing.T) {
	defer func() {
		if r := recover(); r != nil {
			t.Fail()
		}
	}()

	GlobalRecoverHandler = func(value interface{}) {
	}

	counter := 0

	RunWithRestart(func() {
		counter++
		panic("panic")
	}).WithRestartTimeout(time.Millisecond)

	time.Sleep(2 * time.Millisecond)
	require.True(t, counter > 1, "counter must be > 1")

	time.Sleep(2 * time.Millisecond)
	require.True(t, counter > 2, "counter must be > 2")

	if counter == 0 {
		t.Fail()
	}
}
