package redis

import (
	"github.com/jitsucom/jitsu/server/logging"
	"github.com/jitsucom/jitsu/server/safego"
	"time"
)

//LockController is for extend the lock every heartbeat period
//it allows kill the server and don't wait releasing the lock a long time
type LockController struct {
	lockName        string
	heartbeatPeriod time.Duration
	lockExtender    LockExtender

	closed chan struct{}
}

func NewController(lockName string, heartbeatPeriod time.Duration, lockExtender LockExtender) *LockController {
	return &LockController{
		lockName:        lockName,
		heartbeatPeriod: heartbeatPeriod,
		lockExtender:    lockExtender,
		closed:          make(chan struct{}),
	}
}

//StartHeartbeat starts a goroutine for extending the lock
func (c *LockController) StartHeartbeat() {
	ticker := time.NewTicker(c.heartbeatPeriod)
	safego.RunWithRestart(func() {
		for {
			select {
			case <-c.closed:
				ticker.Stop()
				return
			case <-ticker.C:
				_, err := c.lockExtender.Extend()
				if err != nil {
					logging.SystemErrorf("[lock: %s] error extending: %v", c.lockName, err)
				}
			}
		}
	})
}

func (c *LockController) Close() {
	close(c.closed)
}
