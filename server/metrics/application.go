package metrics

import (
	"time"

	"github.com/jitsucom/jitsu/server/safego"
	"github.com/prometheus/client_golang/prometheus"
)

var (
	runningApplication *prometheus.Counter
	runningTicker      *time.Ticker
	closed             chan struct{}
)

func initApplication() {
	runningApplication = NewCounter(
		prometheus.CounterOpts{
			Namespace: "eventnative",
			Subsystem: "self",
			Name:      "running",
			Help:      "Shows how many seconds application running",
		})

	StartRunningCounter(1)
}

func StartRunningCounter(seconds int) {
	closed = make(chan struct{})
	runningTicker = time.NewTicker(time.Duration(seconds) * time.Second)
	safego.RunWithRestart(func() {
		for {
			select {
			case <-closed:
				runningTicker.Stop()
				return
			case <-runningTicker.C:
				ApplicationRunning(float64(seconds))
			}
		}
	})
}

func StopRunningCounter() {
	if closed != nil {
		close(closed)
		closed = nil
	}
}

func ApplicationRunning(value float64) {
	if Enabled() {
		(*runningApplication).Add(value)
	}
}
