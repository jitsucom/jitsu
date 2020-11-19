package events

import (
	"encoding/json"
	"github.com/jitsucom/eventnative/logging"
	"github.com/jitsucom/eventnative/meta"
	"github.com/jitsucom/eventnative/safego"
	"github.com/jitsucom/eventnative/schema"
	"time"
)

type CachedFact struct {
	destinationId string
	eventId       string
	fact          Fact

	table     *schema.Table
	processed Fact
	error     string
}

type Cache struct {
	storage                meta.Storage
	putCh                  chan *CachedFact
	putCh                  chan *CachedFact
	capacityPerDestination int

	closed bool
}

//return Cache and start goroutine for async operations
func NewCache(storage meta.Storage, capacityPerDestination int) *Cache {
	c := &Cache{
		storage:                storage,
		putCh:                  make(chan *CachedFact, 1000000),
		capacityPerDestination: capacityPerDestination,
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
				c.Put(cf.destinationId, cf.eventId, cf.fact)
			}
		}
	})

	safego.RunWithRestart(func() {
		for {
			if c.closed {
				break
			}

			cf := <-c.putCh
			if cf != nil {
				c.Put(cf.destinationId, cf.eventId, cf.fact)
			}
		}
	})
}

//PutAsync put value into channel
func (c *Cache) PutAsync(destinationId, eventId string, value Fact) {
	select {
	case c.putCh <- &CachedFact{destinationId: destinationId, eventId: eventId, fact: value}:
	default:
	}
}

//UpdateAsync update value into channel
func (c *Cache) UpdateAsync(destinationId, eventId string, value Fact) {
	select {
	case c.putCh <- &CachedFact{destinationId: destinationId, eventId: eventId, fact: value}:
	default:
	}
}

//Put fact into storage
func (c *Cache) Put(destinationId, eventId string, value Fact) {
	b, err := json.Marshal(value)
	if err != nil {
		logging.SystemError("[%s] Error marshalling event [%v] before caching: %v", destinationId, value, err)
		return
	}
	eventsInCache, err := c.storage.AddEvent(destinationId, eventId, string(b), time.Now().UTC())
	if err != nil {
		logging.SystemError("[%s] Error saving event [%v] in cache: %v", destinationId, value, err)
		return
	}

	if eventsInCache > c.capacityPerDestination {
		err := c.storage.RemoveLastEvent(destinationId)
		if err != nil {
			logging.SystemError("[%s] Error removing event from cache: %v", destinationId, err)
			return
		}
	}
}

//GetN return at most n facts by key
func (c *Cache) GetN(destinationId string, start, end time.Time, n int) []meta.Event {
	events, err := c.storage.GetEvents(destinationId, start, end, n)
	if err != nil {
		logging.SystemErrorf("Error getting %d cached events for [%s] destination: %v", n, destinationId, err)
		return []meta.Event{}
	}

	return events
}

/*
//GetAll return at most n facts
func (c *Cache) GetAll(n int) []Fact {
	return c.all.GetN(n)
}
*/
func (c *Cache) Close() error {
	c.closed = true
	return nil
}
