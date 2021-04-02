package telemetry

import (
	"sync/atomic"
)

//Collector is a thread-safe collector for events accounting
type Collector struct {
	pushedEvents uint64
	pulledEvents uint64
}

//PushEvent increments pushed events (from js/api) counter
func (c *Collector) PushEvent() {
	atomic.AddUint64(&c.pushedEvents, 1)
}

//PullEvent increments pulled events (from 3rd party platforms) counter
func (c *Collector) PullEvent() {
	atomic.AddUint64(&c.pulledEvents, 1)
}

//Cut returns current value of pushed events and pulled events and, also, set it to 0
func (c *Collector) Cut() (uint64, uint64) {
	return atomic.SwapUint64(&c.pushedEvents, 0), atomic.SwapUint64(&c.pulledEvents, 0)
}
