package cluster

import (
	"github.com/jitsucom/jitsu/server/logging"
	"github.com/jitsucom/jitsu/server/safego"
	"time"
)

//heartbeat is a periodic heartbeat executer
type heartbeat struct {
	manager Manager

	closed chan struct{}
}

//newHeartbeat returns new heartbeat
func newHeartbeat(manager Manager) *heartbeat {
	return &heartbeat{
		manager: manager,
		closed:  make(chan struct{}),
	}
}

//start runs a goroutine for heartbeat
func (h *heartbeat) start() {
	heartbeatTicker := time.NewTicker(time.Second * 90)
	safego.RunWithRestart(func() {
		for {
			select {
			case <-h.closed:
				heartbeatTicker.Stop()
				return
			case <-heartbeatTicker.C:
				if err := h.manager.heartbeat(); err != nil {
					logging.Errorf("failed to heartbeat server cluster information: %v", err)
					//delay after error
					time.Sleep(2 * time.Second)
					continue
				}
			}
		}
	})
}

func (h *heartbeat) Close() error {
	close(h.closed)
	return nil
}
