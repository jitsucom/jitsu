package adapters

import (
	"encoding/json"
	"errors"
	"fmt"
	"github.com/joncrlsn/dque"
	"go.uber.org/atomic"
	"time"
)

const requestsPerPersistedFile = 2000

//ErrQueueClosed is a error in case when queue has been already closed
var ErrQueueClosed = errors.New("queue is closed")

//QueuedRequest is a dto for serialization in persistent queue
type QueuedRequest struct {
	SerializedRetryableRequest []byte
}

//RetryableRequest is an HTTP request with retry count
type RetryableRequest struct {
	Request      *Request
	Retry        int
	DequeuedTime time.Time
	EventContext *EventContext
}

//Request is a dto for serialization custom http.Request
type Request struct {
	URL     string
	Method  string
	Body    []byte
	Headers map[string]string
}

//QueuedRequestBuilder creates and returns a new *adapters.QueuedRequest (must be pointer).
// This is used when we load a segment of the queue from disk.
func QueuedRequestBuilder() interface{} {
	return &QueuedRequest{}
}

//PersistentQueue is a queue (persisted on file system) with requests
type PersistentQueue struct {
	queue *dque.DQue
	size  *atomic.Uint64
}

//NewPersistentQueue returns configured PersistentQueue instance
func NewPersistentQueue(queueName, fallbackDir string) (*PersistentQueue, error) {
	queue, err := dque.NewOrOpen(queueName, fallbackDir, requestsPerPersistedFile, QueuedRequestBuilder)
	if err != nil {
		return nil, fmt.Errorf("Error opening/creating HTTP requests queue [%s] in Dir [%s]: %v", queueName, fallbackDir, err)
	}
	return &PersistentQueue{queue: queue, size: atomic.NewUint64(uint64(queue.Size()))}, nil
}

//Add puts HTTP request and error callback to the queue
func (pq *PersistentQueue) Add(req *Request, eventContext *EventContext) error {
	return pq.AddRequest(&RetryableRequest{Request: req, DequeuedTime: time.Now().UTC(), Retry: 0, EventContext: eventContext})
}

//AddRequest puts request to the queue with retryCount
func (pq *PersistentQueue) AddRequest(req *RetryableRequest) error {
	serialized, _ := json.Marshal(req)
	if err := pq.queue.Enqueue(&QueuedRequest{SerializedRetryableRequest: serialized}); err != nil {
		return err
	}

	pq.size.Inc()
	return nil
}

//DequeueBlock waits when enqueued request is ready and return it
func (pq *PersistentQueue) DequeueBlock() (*RetryableRequest, error) {
	iface, err := pq.queue.DequeueBlock()
	if err != nil {
		if err == dque.ErrQueueClosed {
			err = ErrQueueClosed
		}
		return nil, err
	}

	pq.size.Dec()

	wrappedReq, ok := iface.(*QueuedRequest)
	if !ok {
		return nil, fmt.Errorf("Dequeued object is not a QueuedRequest instance. Type is: %T", iface)
	}

	retryableRequest := &RetryableRequest{}
	err = json.Unmarshal(wrappedReq.SerializedRetryableRequest, retryableRequest)
	if err != nil {
		return nil, fmt.Errorf("Error deserializing RetryableRequest from the HTTP queue: %v", err)
	}

	return retryableRequest, nil
}

//Size returns queue size. Separate atomic counter is used because queue.Size() is a blocking operation
func (pq *PersistentQueue) Size() uint64 {
	return pq.size.Load()
}

//Close closes underlying persistent queue
func (pq *PersistentQueue) Close() error {
	return pq.queue.Close()
}
