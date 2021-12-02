package users

import (
	"fmt"
	"github.com/jitsucom/jitsu/server/logging"
	"github.com/jitsucom/jitsu/server/metrics"
	"github.com/jitsucom/jitsu/server/queue"
	"time"
)

const (
	debugElementCountThreshold = 50
	queueIdentifier            = "users_recognition"
)

type Queue struct {
	identifier string
	queue      queue.Queue

	closed chan struct{}
}

func newQueue() *Queue {
	inmemoryQueue := queue.NewInMemory()

	metrics.InitialUsersRecognitionQueueSize(int(inmemoryQueue.Size()))

	return &Queue{identifier: queueIdentifier, queue: inmemoryQueue, closed: make(chan struct{}, 1)}
}

func (q *Queue) startMonitor() {
	debugTicker := time.NewTicker(time.Minute * 10)
	for {
		select {
		case <-q.closed:
			return
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
