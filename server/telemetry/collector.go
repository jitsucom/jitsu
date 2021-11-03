package telemetry

//Collector is a thread-safe collector for events accounting
//per source - destination pair, src,
type Collector struct {
	events *Counter
	errors *Counter
}

func newCollector() *Collector {
	return &Collector{
		events: newCounter(),
		errors: newCounter(),
	}
}

//Event increments events counter
func (c *Collector) Event(sourceID, destinationID, src, sourceType string, quantity uint64) {
	c.events.AddValue(CriteriaKey{
		sourceID:      sourceID,
		destinationID: destinationID,
		src:           src,
		sourceType:    sourceType,
	}, quantity)
}

//Error increments errors counter
func (c *Collector) Error(sourceID, destinationID, src, sourceType string, quantity uint64) {
	c.errors.AddValue(CriteriaKey{
		sourceID:      sourceID,
		destinationID: destinationID,
		src:           src,
		sourceType:    sourceType,
	}, quantity)
}

//Cut returns current counters values (events and errors)
func (c *Collector) Cut() (map[CriteriaKey]uint64, map[CriteriaKey]uint64) {
	return c.events.Cut(), c.errors.Cut()
}
