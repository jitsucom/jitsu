package users

import (
	"fmt"
	"github.com/jitsucom/jitsu/server/logging"
	"github.com/jitsucom/jitsu/server/metrics"
	"github.com/jitsucom/jitsu/server/queue"
	"time"
)

const (
	defaultQueueCapacity       = 20_000_000
	debugElementCountThreshold = 20
	queueIdentifier            = "users_recognition"
)

type Queue struct {
	identifier string
	queue      queue.Queue

	closed chan struct{}
}

func newQueue() *Queue {
	inmemoryQueue := queue.NewInMemory(defaultQueueCapacity)

	metrics.InitialUsersRecognitionQueueSize(int(inmemoryQueue.Size()))

	return &Queue{identifier: queueIdentifier, queue: inmemoryQueue}
}

func (q *Queue) startMonitor() {
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

func (q *Queue) Enqueue(rp *RecognitionPayload) error {
	if err := q.queue.Push(rp); err != nil {
		return err
	}

	metrics.EnqueuedRecognitionEvent()

	return nil
}

func (q *Queue) DequeueBlock() (*RecognitionPayload, error) {
	rpi, err := q.queue.Pop()
	if err != nil {
		return nil, err
	}

	rp, ok := rpi.(*RecognitionPayload)
	if !ok {
		return nil, fmt.Errorf("wrong type of recognition payload dto in queue. Expected: *RecognitionPayload, actual: %T (%s)", rpi, rpi)
	}

	metrics.DequeuedRecognitionEvent()

	return rp, nil
}

//Close closes underlying queue
func (q *Queue) Close() error {
	close(q.closed)
	return q.queue.Close()
}
