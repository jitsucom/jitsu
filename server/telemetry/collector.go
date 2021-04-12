package telemetry

import (
	"sync"
)

//EventsCollector is a thread-safe collector for events accounting
type EventsCollector struct {
	mu           sync.Mutex
	eventsPerSrc map[string]uint64
}

func NewEventsCollector() *EventsCollector {
	return &EventsCollector{
		mu:           sync.Mutex{},
		eventsPerSrc: map[string]uint64{},
	}
}

//Event increments events counter per src
func (ec *EventsCollector) Event(src string) {
	ec.mu.Lock()
	defer ec.mu.Unlock()

	ec.eventsPerSrc[src]++
}

//Cut returns current values per src and set it to 0
func (ec *EventsCollector) Cut() map[string]uint64 {
	ec.mu.Lock()
	defer ec.mu.Unlock()

	result := map[string]uint64{}
	for k, v := range ec.eventsPerSrc {
		result[k] = v
	}
	ec.eventsPerSrc = map[string]uint64{}
	return result
}
