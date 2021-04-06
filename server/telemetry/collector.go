package telemetry

import (
	"sync/atomic"
)

//Collector is a thread-safe collector for events accounting
type Collector struct {
	events uint64
}

//Event increment events counter
func (c *Collector) Event() {
	atomic.AddUint64(&c.events, 1)
}

//Cut return current value and set it to 0
func (c *Collector) Cut() uint64 {
	return atomic.SwapUint64(&c.events, 0)
}
