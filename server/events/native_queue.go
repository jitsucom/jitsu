package events

import (
	"fmt"
	"github.com/jitsucom/jitsu/server/logging"
	"github.com/jitsucom/jitsu/server/metrics"
	"github.com/jitsucom/jitsu/server/queue"
	"github.com/jitsucom/jitsu/server/safego"
	"time"
)

const (
	defaultQueueCapacity       = 20_000_000
	debugElementCountThreshold = 20
)

//NativeQueue is a Jitsu created queue
type NativeQueue struct {
	identifier string
	queue      queue.Queue

	closed chan struct{}
}

func NewNativeQueue(identifier string) (Queue, error) {
	inmemoryQueue := queue.NewInMemory(defaultQueueCapacity)

	metrics.InitialStreamEventsQueueSize(identifier, int(inmemoryQueue.Size()))

	nq := &NativeQueue{
		queue:      inmemoryQueue,
		identifier: identifier,
		closed:     make(chan struct{}, 1),
	}

	safego.Run(nq.startMonitor)
	return nq, nil
}

func (q *NativeQueue) startMonitor() {
	percentTicker := time.NewTicker(time.Minute)
	debugTicker := time.NewTicker(time.Minute * 10)
	for {
		select {
		case <-q.closed:
			return
		case <-percentTicker.C:
			size := q.queue.Size()
			if size > int64(defaultQueueCapacity*0.6) {
				logging.Warnf("[queue: %s] 60% of queue capacity has been taken! Current: %d capacity: %d (%0.2f %%)", q.identifier, size, defaultQueueCapacity, size/defaultQueueCapacity*100)
			}
		case <-debugTicker.C:
			size := q.queue.Size()
			if size > debugElementCountThreshold {
				logging.Infof("[queue: %s] current size: %d", q.identifier, size)
			}
		}
	}
}

func (q *NativeQueue) Consume(f map[string]interface{}, tokenID string) {
	q.ConsumeTimed(f, time.Now().UTC(), tokenID)
}

func (q *NativeQueue) ConsumeTimed(payload map[string]interface{}, t time.Time, tokenID string) {
	te := &TimedEvent{
		Payload:      payload,
		DequeuedTime: t,
		TokenID:      tokenID,
	}

	if err := q.queue.Push(te); err != nil {
		logSkippedEvent(payload, fmt.Errorf("Error putting event event bytes to the queue: %v", err))
		return
	}

	metrics.EnqueuedEvent(q.identifier)
}

func (q *NativeQueue) DequeueBlock() (Event, time.Time, string, error) {
	ite, err := q.queue.Pop()
	if err != nil {
		if err == queue.ErrQueueClosed {
			return nil, time.Time{}, "", ErrQueueClosed
		}

		return nil, time.Time{}, "", err
	}

	metrics.DequeuedEvent(q.identifier)

	te, ok := ite.(*TimedEvent)
	if !ok {
		return nil, time.Time{}, "", fmt.Errorf("wrong type of event dto in queue. Expected: *TimedEvent, actual: %T (%s)", ite, ite)
	}

	return te.Payload, te.DequeuedTime, te.TokenID, nil
}

//Close closes underlying queue
func (q *NativeQueue) Close() error {
	close(q.closed)
	return q.queue.Close()
}
