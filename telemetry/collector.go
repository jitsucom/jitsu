package telemetry

import (
	"sync/atomic"
)

type Collector struct {
	events uint64
}

func (c *Collector) Event() {
	atomic.AddUint64(&c.events, 1)
}

func (c *Collector) Cut() uint64 {
	return atomic.SwapUint64(&c.events, 0)
}
