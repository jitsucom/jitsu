package safego

import (
	"fmt"
	"runtime/debug"
	"time"
)

const defaultRestartTimeout = 2 * time.Second

type RecoverHandler func(value any)

var GlobalRecoverHandler RecoverHandler

func init() {
	GlobalRecoverHandler = func(value interface{}) {
		fmt.Println("panic")
		fmt.Println(value)
		fmt.Println(string(debug.Stack()))
	}
}

type Execution struct {
	f              func()
	recoverHandler RecoverHandler
	restartTimeout time.Duration
}

// Run runs a new goroutine and add panic handler (without restart)
func Run(f func()) *Execution {
	exec := Execution{
		f:              f,
		recoverHandler: GlobalRecoverHandler,
		restartTimeout: 0,
	}
	return exec.run()
}

// RunWithRestart run a new goroutine and add panic handler:
// write logs, wait 2 seconds and restart the goroutine
func RunWithRestart(f func()) *Execution {
	return RunWithRestartTimeout(f, defaultRestartTimeout)
}

// RunWithRestartTimeout is like RunWithRestart but the caller controls the
// restart back-off. Prefer this constructor over the pattern of chaining
// WithRestartTimeout onto RunWithRestart, which mutates the Execution
// after the goroutine has already started — a data race the Go race
// detector flags on the read at run.func1.
func RunWithRestartTimeout(f func(), timeout time.Duration) *Execution {
	exec := Execution{
		f:              f,
		recoverHandler: GlobalRecoverHandler,
		restartTimeout: timeout,
	}
	return exec.run()
}

func (exec *Execution) run() *Execution {
	// Snapshot the restart timeout at spawn time so the goroutine's panic
	// handler does not race with a caller who is still holding the
	// Execution and might mutate restartTimeout via the deprecated
	// WithRestartTimeout setter.
	restartTimeout := exec.restartTimeout
	go func() {
		defer func() {
			if r := recover(); r != nil {
				exec.recoverHandler(r)

				if restartTimeout > 0 {
					time.Sleep(restartTimeout)
					exec.run()
				}
			}
		}()
		exec.f()
	}()
	return exec
}

// WithRestartTimeout mutates the Execution's restart timeout.
//
// Deprecated: this method exists for backward compatibility only. Calling it
// after RunWithRestart has already spawned the goroutine races with the
// goroutine's panic handler, which reads restartTimeout on recovery. Use
// RunWithRestartTimeout(f, timeout) instead — it sets the timeout before
// the goroutine starts and captures it as a local at spawn time, so a
// subsequent mutation via this setter (or a future setter) cannot race.
func (exec *Execution) WithRestartTimeout(timeout time.Duration) *Execution {
	exec.restartTimeout = timeout
	return exec
}
