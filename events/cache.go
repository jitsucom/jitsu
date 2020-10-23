package events

import "sync"

//CachedFact is channel holder for key and value
type CachedFact struct {
	key  string
	fact Fact
}

//CachedBucket is slice of events(facts) under the hood
//swapPointer is used for overwrite values without copying underlying slice
type CachedBucket struct {
	sync.RWMutex

	facts       []Fact
	swapPointer int
	capacity    int
}

//Put value in underlying slice with lock
//e.g. capacity = 3
// swapPointer = 0, [1, 2, 3] + 4 = [3, 2, 4]
// swapPointer = 1, [3, 2, 4] + 5 = [3, 4, 5]
// swapPointer = 0, [3, 4, 5] + 6 = [5, 4, 6]
func (ce *CachedBucket) Put(value Fact) {
	ce.Lock()

	if len(ce.facts) == ce.capacity {
		lastIndex := len(ce.facts) - 1
		last := ce.facts[lastIndex]
		ce.facts[ce.swapPointer] = last
		ce.facts[lastIndex] = value
		ce.swapPointer += 1
		if ce.swapPointer == ce.capacity-1 {
			ce.swapPointer = 0
		}
	} else {
		ce.facts = append(ce.facts, value)
	}

	ce.Unlock()
}

//Get return <= n elements from bucket with read lock
func (ce *CachedBucket) Get(n int) []Fact {
	ce.RLock()
	defer ce.RUnlock()

	if len(ce.facts) <= n {
		return ce.facts
	}

	return ce.facts[:n]
}

//Cache keep capacityPerKey last elements
//1. per key (perApiKey map)
//2. without key filter (all)
type Cache struct {
	sync.RWMutex

	putCh chan *CachedFact

	perApiKey map[string]*CachedBucket
	all       *CachedBucket

	capacityPerKey int
	closed         bool
}

//return Cache and start goroutine for async puts
func NewCache(capacityPerKey int) *Cache {
	c := &Cache{
		putCh:          make(chan *CachedFact, 1000000),
		perApiKey:      map[string]*CachedBucket{},
		capacityPerKey: capacityPerKey,
		all: &CachedBucket{
			facts:       make([]Fact, 0, capacityPerKey),
			swapPointer: 0,
			capacity:    capacityPerKey,
		},
	}
	c.start()
	return c
}

//start goroutine for reading from putCh and put to cache (async put)
func (c *Cache) start() {
	go func() {
		for {
			if c.closed {
				break
			}

			cf := <-c.putCh
			if cf != nil {
				c.Put(cf.key, cf.fact)
			}
		}
	}()
}

//PutAsync put value into channel
func (c *Cache) PutAsync(key string, value Fact) {
	select {
	case c.putCh <- &CachedFact{key: key, fact: value}:
	default:
	}

}

//Put fact to map per key and to all with lock
func (c *Cache) Put(key string, value Fact) {
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
				facts:       make([]Fact, 0, c.capacityPerKey),
				swapPointer: 0,
				capacity:    c.capacityPerKey,
			}
			c.perApiKey[key] = element
		}
		c.Unlock()
	}

	element.Put(value)
}

//GetN return at most n facts by key
func (c *Cache) GetN(key string, n int) []Fact {
	c.RLock()

	element, ok := c.perApiKey[key]
	if ok {
		c.RUnlock()

		return element.Get(n)
	} else {
		c.RUnlock()
		return []Fact{}
	}
}

//GetAll return at most n facts
func (c *Cache) GetAll(n int) []Fact {
	return c.all.Get(n)
}

func (c *Cache) Close() error {
	c.closed = true
	return nil
}
