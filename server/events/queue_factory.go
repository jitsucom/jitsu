package events

import (
	"github.com/jitsucom/jitsu/server/logging"
	"github.com/jitsucom/jitsu/server/meta"
	"github.com/jitsucom/jitsu/server/queue"
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

type QueueFactory struct {
	redisPool *meta.RedisPool
}

func NewQueueFactory(redisPool *meta.RedisPool) *QueueFactory {
	return &QueueFactory{redisPool: redisPool}
}

func (qf *QueueFactory) Create(identifier, queueName, logEventPath string) (Queue, error) {
	//DEPRECATED
	//return NewDQueBasedQueue(identifier, queueName, logEventPath)
	//return NewLevelDBQueue(identifier, queueName, logEventPath)

	var underlyingQueue queue.Queue
	if qf.redisPool != nil {
		logging.Infof("[%s] initializing redis events queue")
		underlyingQueue = queue.NewRedis(identifier, qf.redisPool, TimedEventBuilder)
	} else {
		logging.Infof("[%s] initializing inmemory events queue")
		underlyingQueue = queue.NewInMemory()
	}
	return NewNativeQueue(identifier, underlyingQueue)
}

func logSkippedEvent(event Event, err error) {
	logging.Warnf("Unable to enqueue object %v reason: %v. This object will be skipped", event, err)
}
