package queue

import (
	"errors"
)

import (
	"context"
	"sync"
	"time"
)

const (
	WaitForNextElementChanCapacity           = 1024
	dequeueOrWaitForNextElementInvokeGapTime = 10
)

var (
	ErrTooManyWatchers = errors.New("empty queue and can't wait for next element because there are too many Poll() waiting")
	ErrQueueEmpty      = errors.New("queue is empty")
)

// InMemory is an in-memory RWMutex+slice based Queue
type InMemory struct {
	slice []interface{}
	mutex sync.RWMutex

	// queue for watchers that will wait for next elements (if queue is empty at DequeueOrWaitForNextElement execution )
	waitForNextElementChan chan chan interface{}

	closed chan struct{}
}

func NewInMemory() Queue {
	return &InMemory{
		slice:                  make([]interface{}, 0, 30),
		waitForNextElementChan: make(chan chan interface{}, WaitForNextElementChanCapacity),
		closed:                 make(chan struct{}, 1),
	}
}

//Push enqueues an element. Returns ErrQueueClosed if queue is closed
func (im *InMemory) Push(value interface{}) error {

	// check if there is a listener waiting for the next element (this element)
	select {
	case <-im.closed:
		return ErrQueueClosed
	case listener := <-im.waitForNextElementChan:
		// send the element through the listener's channel instead of enqueue it
		select {
		case listener <- value:
		default:
			// enqueue if listener is not ready

			// lock the object to enqueue the element into the slice
			im.mutex.Lock()
			// enqueue the element
			im.slice = append(im.slice, value)
			defer im.mutex.Unlock()
		}

	default:
		// lock the object to enqueue the element into the slice
		im.mutex.Lock()
		// enqueue the element
		im.slice = append(im.slice, value)
		defer im.mutex.Unlock()
	}

	return nil
}

// Pop dequeues an element (if exist) or waits until the next element gets enqueued and returns it.
// Multiple calls to DequeueOrWaitForNextElement() would enqueue multiple "listeners" for future enqueued elements.
func (im *InMemory) Pop() (interface{}, error) {
	return im.DequeueOrWaitForNextElementContext(context.Background())
}

// DequeueOrWaitForNextElementContext dequeues an element (if exist) or waits until the next element gets enqueued and returns it.
// Multiple calls to DequeueOrWaitForNextElementContext() would enqueue multiple "listeners" for future enqueued elements.
// When the passed context expires this function exits and returns the context' error
func (im *InMemory) DequeueOrWaitForNextElementContext(ctx context.Context) (interface{}, error) {
	for {
		select {
		case <-im.closed:
			return nil, ErrQueueClosed
		default:
		}

		// get the slice's len
		im.mutex.Lock()
		length := len(im.slice)
		im.mutex.Unlock()

		if length == 0 {
			// channel to wait for next enqueued element
			waitChan := make(chan interface{})

			select {
			// enqueue a watcher into the watchForNextElementChannel to wait for the next element
			case im.waitForNextElementChan <- waitChan:

				// re-checks every i milliseconds (top: 10 times) ... the following verifies if an item was enqueued
				// around the same time DequeueOrWaitForNextElementContext was invoked, meaning the waitChan wasn't yet sent over
				// im.waitForNextElementChan
				for i := 0; i < dequeueOrWaitForNextElementInvokeGapTime; i++ {
					select {
					case <-ctx.Done():
						return nil, ctx.Err()
					case <-im.closed:
						return nil, ErrQueueClosed
					case dequeuedItem := <-waitChan:
						return dequeuedItem, nil
					case <-time.After(time.Millisecond * time.Duration(i)):
						if dequeuedItem, err := im.dequeue(); err == nil {
							return dequeuedItem, nil
						}
					}
				}

				// return the next enqueued element, if any
				select {
				case <-im.closed:
					return nil, ErrQueueClosed
				case item := <-waitChan:
					return item, nil
				case <-ctx.Done():
					return nil, ctx.Err()
				}
			default:
				// too many watchers (waitForNextElementChanCapacity) enqueued waiting for next elements
				return nil, ErrTooManyWatchers
			}
		}

		im.mutex.Lock()

		// verify that at least 1 item resides on the queue
		if len(im.slice) == 0 {
			im.mutex.Unlock()
			continue
		}
		elementToReturn := im.slice[0]
		im.slice = im.slice[1:]

		im.mutex.Unlock()
		return elementToReturn, nil
	}
}

//Size returns the number of enqueued elements
func (im *InMemory) Size() int64 {
	im.mutex.RLock()
	defer im.mutex.RUnlock()

	return int64(len(im.slice))
}

func (im *InMemory) Close() error {
	close(im.closed)
	return nil
}

// dequeue dequeues an element. Returns error if queue is locked or empty.
func (im *InMemory) dequeue() (interface{}, error) {
	im.mutex.Lock()
	defer im.mutex.Unlock()

	size := len(im.slice)
	if size == 0 {
		return nil, ErrQueueEmpty
	}

	elementToReturn := im.slice[0]
	im.slice = im.slice[1:]

	return elementToReturn, nil
}
