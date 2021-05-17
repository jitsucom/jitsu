package adapters

import "github.com/jitsucom/jitsu/server/events"

//EventContext is an extracted serializable event identifiers
//it is used in counters/metrics/cache
type EventContext struct {
	CacheDisabled  bool
	DestinationID  string
	EventID        string
	TokenID        string
	Src            string
	RawEvent       events.Event
	ProcessedEvent events.Event
	Table          *Table
}
