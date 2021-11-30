package events

import (
	"github.com/jitsucom/jitsu/server/logging"
	"io"
	"time"
)

//TimedEvent is used for keeping events with time in queue
type TimedEvent struct {
	Payload      map[string]interface{}
	DequeuedTime time.Time
	TokenID      string
}

//Queue is an events queue. Possible implementations (dque, leveldbqueue, native)
type Queue interface {
	io.Closer
	Consume(f map[string]interface{}, tokenID string)
	ConsumeTimed(f map[string]interface{}, t time.Time, tokenID string)
	DequeueBlock() (Event, time.Time, string, error)
}

func NewQueue(identifier, queueName, logEventPath string) (Queue, error) {
	//DEPRECATED
	//return NewDQueBasedQueue(identifier, queueName, logEventPath)
	//return NewLevelDBQueue(identifier, queueName, logEventPath)
	return NewNativeQueue(identifier)
}

func logSkippedEvent(event Event, err error) {
	logging.Warnf("Unable to enqueue object %v reason: %v. This object will be skipped", event, err)
}
