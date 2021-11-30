package queue

import "sync/atomic"

type InMemory struct {
	channel chan interface{}
	size    int64

	closed chan struct{}
}

func NewInMemory(capacity int) Queue {
	return &InMemory{
		channel: make(chan interface{}, capacity),
		size:    0,
		closed:  make(chan struct{}, 1),
	}
}

func (im *InMemory) Push(v interface{}) error {
	select {
	case <-im.closed:
		return ErrQueueClosed
	default:
		im.channel <- v
		atomic.AddInt64(&im.size, 1)
		return nil
	}
}

func (im *InMemory) Pop() (interface{}, error) {
	select {
	case <-im.closed:
		return nil, ErrQueueClosed
	default:
		defer atomic.AddInt64(&im.size, -1)
		return <-im.channel, nil
	}
}

func (im *InMemory) Size() int64 {
	return atomic.LoadInt64(&im.size)
}

func (im *InMemory) Close() error {
	close(im.closed)
	close(im.channel)
	return nil
}
