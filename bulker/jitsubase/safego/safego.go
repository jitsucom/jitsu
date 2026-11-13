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
	exec := Execution{
		f:              f,
		recoverHandler: GlobalRecoverHandler,
		restartTimeout: defaultRestartTimeout,
	}
	return exec.run()
}

func (exec *Execution) run() *Execution {
	go func() {
		defer func() {
			if r := recover(); r != nil {
				exec.recoverHandler(r)

				if exec.restartTimeout > 0 {
					time.Sleep(exec.restartTimeout)
					exec.run()
				}
			}
		}()
		exec.f()
	}()
	return exec
}
