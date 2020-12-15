package events

import (
	"github.com/jitsucom/eventnative/safego"
	"sync"
)

//CachedEvent is channel holder for key and value
type CachedEvent struct {
	key   string
	event Event
}

//CachedBucket is slice of events(events) under the hood
//swapPointer is used for overwrite values without copying underlying slice
type CachedBucket struct {
	sync.RWMutex

	events      []Event
	swapPointer int
	capacity    int
}

//Put value in underlying slice with lock
//e.g. capacity = 3
// swapPointer = 0, [1, 2, 3] + 4 = [3, 2, 4]
// swapPointer = 1, [3, 2, 4] + 5 = [3, 4, 5]
// swapPointer = 0, [3, 4, 5] + 6 = [5, 4, 6]
func (ce *CachedBucket) Put(value Event) {
	ce.Lock()

	if len(ce.events) == ce.capacity {
		lastIndex := len(ce.events) - 1
		last := ce.events[lastIndex]
		ce.events[ce.swapPointer] = last
		ce.events[lastIndex] = value
		ce.swapPointer += 1
		if ce.swapPointer == ce.capacity-1 {
			ce.swapPointer = 0
		}
	} else {
		ce.events = append(ce.events, value)
	}

	ce.Unlock()
}

//Get return <= n elements from bucket with read lock
func (ce *CachedBucket) GetN(n int) []Event {
	ce.RLock()
	defer ce.RUnlock()

	if len(ce.events) <= n {
		return ce.events
	}

	return ce.events[:n]
}

//Cache keep capacityPerKey last elements
//1. per key (perApiKey map)
//2. without key filter (all)
type Cache struct {
	sync.RWMutex

	putCh chan *CachedEvent

	perApiKey map[string]*CachedBucket
	all       *CachedBucket

	capacityPerKey int
	closed         bool
}

//return Cache and start goroutine for async puts
func NewCache(capacityPerKey int) *Cache {
	c := &Cache{
		putCh:          make(chan *CachedEvent, 1000000),
		perApiKey:      map[string]*CachedBucket{},
		capacityPerKey: capacityPerKey,
		all: &CachedBucket{
			events:      make([]Event, 0, capacityPerKey),
			swapPointer: 0,
			capacity:    capacityPerKey,
		},
	}
	c.start()
	return c
}

//start goroutine for reading from putCh and put to cache (async put)
func (c *Cache) start() {
	safego.RunWithRestart(func() {
		for {
			if c.closed {
				break
			}

			cf := <-c.putCh
			if cf != nil {
				c.Put(cf.key, cf.event)
			}
		}
	})
}

//PutAsync put value into channel
func (c *Cache) PutAsync(key string, value Event) {
	select {
	case c.putCh <- &CachedEvent{key: key, event: value}:
	default:
	}

}

//Put event to map per key and to all with lock
func (c *Cache) Put(key string, value Event) {
	//all
	c.all.Put(value)

	//per key
	c.RLock()
	element, ok := c.perApiKey[key]
	c.RUnlock()

	if !ok {
		c.Lock()
		element, ok = c.perApiKey[key]
		if !ok {
			element = &CachedBucket{
				events:      make([]Event, 0, c.capacityPerKey),
				swapPointer: 0,
				capacity:    c.capacityPerKey,
			}
			c.perApiKey[key] = element
		}
		c.Unlock()
	}

	element.Put(value)
}

//GetN return at most n events by key
func (c *Cache) GetN(key string, n int) []Event {
	c.RLock()
	element, ok := c.perApiKey[key]
	c.RUnlock()
	if ok {
		return element.GetN(n)
	}

	return []Event{}
}

//GetAll return at most n events
func (c *Cache) GetAll(n int) []Event {
	return c.all.GetN(n)
}

func (c *Cache) Close() error {
	c.closed = true
	return nil
}
