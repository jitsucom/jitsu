package logging

import (
	"github.com/jitsucom/eventnative/safego"
	"sync"
	"sync/atomic"
	"time"
)

type LogConsumer interface {
	Consume(string)
}

//PeriodicStringWriter collect data and pass to LogConsumer every period time
type PeriodicStringWriter struct {
	sync.RWMutex

	strWriter *StringWriter
	consumer  LogConsumer
	period    time.Duration
	changes   uint64

	closed bool
}

//NewPeriodicStringWriter return PeriodicStringWriter and start goroutine
func NewPeriodicStringWriter(period time.Duration, consumer LogConsumer) *PeriodicStringWriter {
	psw := &PeriodicStringWriter{strWriter: NewStringWriter(), consumer: consumer, period: period}
	psw.start()
	return psw
}

func (psw *PeriodicStringWriter) start() {
	safego.RunWithRestart(func() {
		for {
			if psw.closed {
				break
			}

			psw.RLock()
			if atomic.SwapUint64(&psw.changes, 0) > 0 {
				payload := psw.strWriter.String()
				psw.consumer.Consume(payload)
			}

			psw.RUnlock()

			time.Sleep(psw.period)
		}
	})
}

func (psw *PeriodicStringWriter) String() string {
	psw.RLock()
	defer psw.RUnlock()

	return psw.strWriter.String()
}

func (psw *PeriodicStringWriter) Write(p []byte) (n int, err error) {
	psw.Lock()
	defer psw.Unlock()

	atomic.AddUint64(&psw.changes, 1)
	return psw.strWriter.Write(p)
}

func (psw *PeriodicStringWriter) Close() error {
	psw.closed = true

	if atomic.SwapUint64(&psw.changes, 0) > 0 {
		psw.RLock()
		payload := psw.strWriter.String()
		psw.RUnlock()

		psw.consumer.Consume(payload)
	}

	return psw.strWriter.Close()
}
