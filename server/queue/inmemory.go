package queue

import (
	"errors"
	"fmt"
)

var (
	ErrQueueEmpty = errors.New("queue is empty")
)

type InMemory struct {
	capacity int
	queue    chan interface{}
	closed   chan struct{}
}

func NewInMemory(capacity int) Queue {
	im := &InMemory{
		capacity: capacity,
		queue:    make(chan interface{}, capacity),
		closed:   make(chan struct{}, 1),
	}

	return im
}

//Push enqueues an element. Returns ErrQueueClosed if queue is closed
func (im *InMemory) Push(value interface{}) error {
	// check if there is a listener waiting for the next element (this element)
	select {
	case <-im.closed:
		return ErrQueueClosed
	case im.queue <- value:
		return nil
	default:
		return fmt.Errorf("queue reached max capacity: %d", im.capacity)
	}

}

// Pop dequeues an element (if exist) or waits until the next element gets enqueued and returns it.
// Multiple calls to DequeueOrWaitForNextElement() would enqueue multiple "listeners" for future enqueued elements.
func (im *InMemory) Pop() (interface{}, error) {
	select {
	case <-im.closed:
		return nil, ErrQueueClosed
	default:
		return <-im.queue, nil
	}
}

//Size returns the number of enqueued elements
func (im *InMemory) Size() int64 {
	return int64(len(im.queue))
}

func (im *InMemory) Type() string {
	return InMemoryType
}

func (im *InMemory) Close() error {
	close(im.closed)
	return nil
}
