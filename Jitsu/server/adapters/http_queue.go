package adapters

import (
	"encoding/json"
	"fmt"
	"github.com/jitsucom/jitsu/server/events"
	"github.com/jitsucom/jitsu/server/queue"
	"github.com/jitsucom/jitsu/server/timestamp"
	"time"
)

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
func QueuedRequestBuilder() interface{} {
	return &QueuedRequest{}
}

//HTTPRequestQueue is a queue (persisted on file system) with requests
type HTTPRequestQueue struct {
	queue queue.Queue
}

//NewHTTPRequestQueue returns configured HTTPRequestQueue instance
func NewHTTPRequestQueue(identifier string, queueFactory *events.QueueFactory) *HTTPRequestQueue {
	underlyingQueue := queueFactory.CreateHTTPQueue(identifier, QueuedRequestBuilder)
	return &HTTPRequestQueue{queue: underlyingQueue}
}

//Add puts HTTP request and error callback to the queue
func (pq *HTTPRequestQueue) Add(req *Request, eventContext *EventContext) error {
	return pq.AddRequest(&RetryableRequest{Request: req, DequeuedTime: timestamp.Now().UTC(), Retry: 0, EventContext: eventContext})
}

//AddRequest puts request to the queue with retryCount
func (pq *HTTPRequestQueue) AddRequest(req *RetryableRequest) error {
	serialized, _ := json.Marshal(req)
	return pq.queue.Push(&QueuedRequest{SerializedRetryableRequest: serialized})
}

//DequeueBlock waits when enqueued request is ready and return it
func (pq *HTTPRequestQueue) DequeueBlock() (*RetryableRequest, error) {
	iface, err := pq.queue.Pop()
	if err != nil {
		return nil, err
	}

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

//Size returns queue size
func (pq *HTTPRequestQueue) Size() uint64 {
	return uint64(pq.queue.Size())
}

//Close closes underlying persistent queue
func (pq *HTTPRequestQueue) Close() error {
	return pq.queue.Close()
}
