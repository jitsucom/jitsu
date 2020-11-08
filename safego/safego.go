package safego

import (
	"time"
)

type RecoverHandler func(value interface{})

var GlobalRecoverHandler RecoverHandler

type Execution struct {
	f              func()
	recoverHandler RecoverHandler
}

//RunWithRestart run a new goroutine and add panic handler:
//write logs, wait 3 seconds and restart the goroutine
func RunWithRestart(f func()) *Execution {
	exec := Execution{
		f:              f,
		recoverHandler: GlobalRecoverHandler,
	}
	return exec.run()
}

func (exec *Execution) run() *Execution {
	go func() {
		defer func() {
			if r := recover(); r != nil {
				exec.recoverHandler(r)

				time.Sleep(2 * time.Second)
				exec.run()
			}
		}()
		exec.f()
	}()
	return exec
}
