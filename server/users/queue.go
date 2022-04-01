package users

import (
	"github.com/jitsucom/jitsu/server/logging"
	"github.com/jitsucom/jitsu/server/metrics"
	"github.com/jitsucom/jitsu/server/queue"
	"github.com/jitsucom/jitsu/server/safego"
	"time"
)

const (
	AnonymousQueueName  = "users_recognition"
	IdentifiedQueueName = "users_identified"
	AggregatedQueueName = "users_aggregated"
)

type Queue struct {
	identifier string
	queue      queue.Queue

	closed chan struct{}
}

func newQueue(identifier string, capacity int) *Queue {
	inmemoryQueue := queue.NewInMemory(capacity)

	metrics.InitialUsersRecognitionQueueSize(identifier, int(inmemoryQueue.Size()))

	q := &Queue{identifier: identifier, queue: inmemoryQueue, closed: make(chan struct{}, 1)}
	safego.Run(q.startMonitor)
	return q
}

func (q *Queue) startMonitor() {
	debugTicker := time.NewTicker(time.Minute * 10)
	for {
		select {
		case <-q.closed:
			return
		case <-debugTicker.C:
			size := q.queue.Size()
			logging.Infof("[queue: %s] current size: %d", q.identifier, size)
		}
	}
}

func (q *Queue) Enqueue(rp interface{}) error {
	if err := q.queue.Push(rp); err != nil {
		return err
	}

	metrics.EnqueuedRecognitionEvent(q.identifier)

	return nil
}

func (q *Queue) DequeueBlock() (interface{}, error) {
	rpi, err := q.queue.Pop()
	if err != nil {
		return nil, err
	}

	metrics.DequeuedRecognitionEvent(q.identifier)

	return rpi, nil
}

func (q *Queue) Size() int64 {
	return q.queue.Size()
}

//Close closes underlying queue
func (q *Queue) Close() error {
	close(q.closed)
	return q.queue.Close()
}
