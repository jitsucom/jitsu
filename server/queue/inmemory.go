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

// minQueueLen is smallest capacity that queue may have.
// Must be power of 2 for bitwise modulus: x % n == x & (n - 1).
const minQueueLen = 2048

// InMemory is an in-memory RWMutex+slice based Queue
type InMemory struct {
	buf               []interface{}
	head, tail, count int

	mutex sync.RWMutex

	// queue for watchers that will wait for next elements (if queue is empty at DequeueOrWaitForNextElement execution )
	waitForNextElementChan chan chan interface{}

	closed chan struct{}
}

func NewInMemory() Queue {
	im := &InMemory{
		buf:                    make([]interface{}, minQueueLen),
		waitForNextElementChan: make(chan chan interface{}, WaitForNextElementChanCapacity),
		closed:                 make(chan struct{}, 1),
	}

	return im
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
			im.add(value)
		}

	default:
		im.add(value)
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
		length := im.count
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

		elementToReturn, err := im.dequeue()
		if err != nil {
			continue
		}
		return elementToReturn, nil
	}
}

//Size returns the number of enqueued elements
func (im *InMemory) Size() int64 {
	im.mutex.RLock()
	defer im.mutex.RUnlock()

	return int64(im.count)
}

// resizes the queue to fit exactly twice its current contents
// this can result in shrinking if the queue is less than half-full
func (im *InMemory) resize() {
	newBuf := make([]interface{}, im.count<<1)

	if im.tail > im.head {
		copy(newBuf, im.buf[im.head:im.tail])
	} else {
		n := copy(newBuf, im.buf[im.head:])
		copy(newBuf[n:], im.buf[:im.tail])
	}

	im.head = 0
	im.tail = im.count
	im.buf = newBuf
}

// Add puts an element on the end of the queue.
func (im *InMemory) add(elem interface{}) {
	im.mutex.Lock()
	defer im.mutex.Unlock()
	if im.count == len(im.buf) {
		im.resize()
	}

	im.buf[im.tail] = elem
	// bitwise modulus
	im.tail = (im.tail + 1) & (len(im.buf) - 1)
	im.count++
}

func (im *InMemory) Type() string {
	return InMemoryType
}

func (im *InMemory) Close() error {
	close(im.closed)
	return nil
}

// dequeue dequeues an element. Returns error if queue is locked or empty.
func (im *InMemory) dequeue() (interface{}, error) {
	im.mutex.Lock()
	defer im.mutex.Unlock()
	if im.count <= 0 {
		return nil, ErrQueueEmpty
	}
	ret := im.buf[im.head]
	im.buf[im.head] = nil
	// bitwise modulus
	im.head = (im.head + 1) & (len(im.buf) - 1)
	im.count--
	// Resize down if buffer 1/4 full.
	if len(im.buf) > minQueueLen && (im.count<<2) == len(im.buf) {
		im.resize()
	}
	return ret, nil
}
