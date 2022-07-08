package queue

import (
	"errors"
	"sync"
)

//node storage of queue data
type node struct {
	data interface{}
	prev *node
	next *node
}

//queueBackend Backend storage of the queue, a double linked list
type queueBackend struct {
	//Pointers to root and end
	head *node
	tail *node

	//keep track of current size
	size    uint32
	maxSize uint32
}

func (queue *queueBackend) createNode(data interface{}) *node {
	node := node{}
	node.data = data

	return &node
}

func (queue *queueBackend) put(data interface{}) error {
	if queue.size >= queue.maxSize {
		err := errors.New("Queue full")
		return err
	}

	if queue.size == 0 {
		//new root node
		node := queue.createNode(data)
		queue.head = node
		queue.tail = node

		queue.size++

		return nil
	}

	//queue non-empty append to head
	currentTail := queue.tail
	newTail := queue.createNode(data)
	newTail.prev = currentTail
	currentTail.next = newTail

	queue.tail = newTail
	queue.size++
	return nil
}

func (queue *queueBackend) pop() (interface{}, error) {
	if queue.size == 0 {
		err := errors.New("Queue empty")
		return nil, err
	}

	currentHead := queue.head
	newHead := currentHead.next

	if newHead != nil {
		newHead.prev = nil
	}

	queue.size--
	if queue.size == 0 {
		queue.head = nil
		queue.tail = nil
	} else {
		queue.head = newHead
	}

	return currentHead.data, nil
}

func (queue *queueBackend) isEmpty() bool {
	return queue.size == 0
}

func (queue *queueBackend) isFull() bool {
	return queue.size >= queue.maxSize
}

//ConcurrentLinkedQueue concurrent queue
type ConcurrentLinkedQueue struct {
	//mutex lock
	lock *sync.Mutex

	//empty and full locks
	notEmpty *sync.Cond
	notFull  *sync.Cond

	closed bool
	//queue storage backend
	backend *queueBackend
}

func (c *ConcurrentLinkedQueue) Enqueue(data interface{}) error {
	c.lock.Lock()

	for c.backend.isFull() && !c.closed {
		//wait for empty
		c.notFull.Wait()
	}
	if c.closed {
		c.lock.Unlock()
		return ErrQueueClosed
	}
	//insert
	err := c.backend.put(data)

	//signal notEmpty
	c.notEmpty.Signal()

	c.lock.Unlock()

	return err
}

func (c *ConcurrentLinkedQueue) Dequeue() (interface{}, error) {
	c.lock.Lock()

	for c.backend.isEmpty() && !c.closed {
		c.notEmpty.Wait()
	}
	if c.closed {
		c.lock.Unlock()
		return nil, ErrQueueClosed
	}

	data, err := c.backend.pop()

	//signal notFull
	c.notFull.Signal()

	c.lock.Unlock()

	return data, err
}

func (c *ConcurrentLinkedQueue) GetSize() uint32 {
	c.lock.Lock()
	size := c.backend.size
	c.lock.Unlock()

	return size
}

func (c *ConcurrentLinkedQueue) GetMaxSize() uint32 {
	c.lock.Lock()
	maxSize := c.backend.maxSize
	c.lock.Unlock()

	return maxSize
}

func (c *ConcurrentLinkedQueue) Close() {
	c.lock.Lock()
	c.closed = true
	c.notFull.Broadcast()
	c.notEmpty.Broadcast()
	c.lock.Unlock()
}

//NewConcurrentLinkedQueue Creates a new queue
func NewConcurrentLinkedQueue(maxSize uint32) *ConcurrentLinkedQueue {
	queue := ConcurrentLinkedQueue{}

	//init mutexes
	queue.lock = &sync.Mutex{}
	queue.notFull = sync.NewCond(queue.lock)
	queue.notEmpty = sync.NewCond(queue.lock)
	if maxSize == 0 {
		maxSize = 1
	}
	//init backend
	queue.backend = &queueBackend{maxSize: maxSize}
	return &queue
}
