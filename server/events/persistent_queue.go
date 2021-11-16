package events

import (
	"github.com/jitsucom/jitsu/server/logging"
	"io"
	"time"
)

//PersistentQueue is a persistent events queue. Possible implementations (dque, leveldbqueue)
type PersistentQueue interface {
	io.Closer
	Consume(f map[string]interface{}, tokenID string)
	ConsumeTimed(f map[string]interface{}, t time.Time, tokenID string)
	DequeueBlock() (Event, time.Time, string, error)
}

func NewPersistentQueue(identifier, queueName, logEventPath string) (PersistentQueue, error) {
	//return NewDQueBasedQueue(identifier, queueName, logEventPath)
	return NewLevelDBQueue(identifier, queueName, logEventPath)
}

func logSkippedEvent(event Event, err error) {
	logging.Warnf("Unable to enqueue object %v reason: %v. This object will be skipped", event, err)
}
