package events

import (
	"fmt"
	"io"
	"time"

	"github.com/jitsucom/jitsu/server/logging"
	"github.com/jitsucom/jitsu/server/meta"
	"github.com/jitsucom/jitsu/server/queue"
)

//TimedEvent is used for keeping events with time in queue
type TimedEvent struct {
	Payload      map[string]interface{}
	DequeuedTime time.Time
	TokenID      string
}

type DummyQueue struct {
}

func (d *DummyQueue) Close() error {
	return nil
}

func (d *DummyQueue) Consume(f map[string]interface{}, tokenID string) {
}

func (d *DummyQueue) ConsumeTimed(f map[string]interface{}, t time.Time, tokenID string) {
}

func (d *DummyQueue) DequeueBlock() (Event, time.Time, string, error) {
	return nil, time.Time{}, "", fmt.Errorf("DequeueBlock not supported on DummyQueue")
}

//Queue is an events queue. Possible implementations (dque, leveldbqueue, native)
type Queue interface {
	io.Closer
	Consume(f map[string]interface{}, tokenID string)
	ConsumeTimed(f map[string]interface{}, t time.Time, tokenID string)
	DequeueBlock() (Event, time.Time, string, error)
}

type QueueFactory struct {
	redisPool        *meta.RedisPool
	redisReadTimeout time.Duration
}

func NewQueueFactory(redisPool *meta.RedisPool, redisReadTimeout time.Duration) *QueueFactory {
	return &QueueFactory{redisPool: redisPool, redisReadTimeout: redisReadTimeout}
}

func (qf *QueueFactory) CreateEventsQueue(subsystem, identifier string) (Queue, error) {
	var underlyingQueue queue.Queue
	if qf.redisPool != nil {
		logging.Infof("[%s] initializing redis events queue", identifier)
		underlyingQueue = queue.NewRedis(queue.DestinationNamespace, identifier, qf.redisPool, TimedEventBuilder, qf.redisReadTimeout)
	} else {
		logging.Infof("[%s] initializing inmemory events queue", identifier)
		underlyingQueue = queue.NewInMemory(1_000_000)
	}
	return NewNativeQueue(queue.DestinationNamespace, subsystem, identifier, underlyingQueue)
}

func (qf *QueueFactory) CreateHTTPQueue(identifier string, serializationModelBuilder func() interface{}) queue.Queue {
	if qf.redisPool != nil {
		return queue.NewRedis(queue.HTTPAdapterNamespace, identifier, qf.redisPool, serializationModelBuilder, qf.redisReadTimeout)
	} else {
		return queue.NewInMemory(1_000_000)
	}
}

func (qf *QueueFactory) Close() error {
	if qf.redisPool != nil {
		return qf.redisPool.Close()
	}

	return nil
}

func logSkippedEvent(event Event, err error) {
	logging.Warnf("Unable to enqueue object %v reason: %v. This object will be skipped", event, err)
}
