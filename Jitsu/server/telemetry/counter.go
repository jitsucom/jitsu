package telemetry

import "sync"

//CriteriaKey is a key struct for map[CriteriaKey]value
//keeps hashed source and destination ids
type CriteriaKey struct {
	sourceID      string
	destinationID string
	src           string
	sourceType    string
}

//Counter atomic counter
type Counter struct {
	mu   sync.RWMutex
	data map[CriteriaKey]uint64
}

func newCounter() *Counter {
	return &Counter{
		mu:   sync.RWMutex{},
		data: map[CriteriaKey]uint64{},
	}
}

//Add increments value under the key
func (c *Counter) Add(key CriteriaKey) {
	c.mu.Lock()
	defer c.mu.Unlock()

	c.data[key]++
}

//AddValue adds value to the value under the key
func (c *Counter) AddValue(key CriteriaKey, value uint64) {
	c.mu.Lock()
	defer c.mu.Unlock()

	c.data[key] += value
}

//Cut returns current value and set it to 0
func (c *Counter) Cut() map[CriteriaKey]uint64 {
	c.mu.Lock()
	defer c.mu.Unlock()

	result := map[CriteriaKey]uint64{}

	for k, v := range c.data {
		result[k] = v
	}

	c.data = map[CriteriaKey]uint64{}

	return result
}
