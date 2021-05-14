package adapters

import (
	"encoding/json"
	"fmt"
	"github.com/jitsucom/jitsu/server/events"
	"github.com/jitsucom/jitsu/server/logging"
	"github.com/jitsucom/jitsu/server/safego"
	"github.com/panjf2000/ants/v2"
	"io/ioutil"
	"net/http"
	"time"
)

//HTTPAdapterConfiguration is a dto for creating HTTPAdapter
type HTTPAdapterConfiguration struct {
	DestinationID  string
	Dir            string
	HTTPConfig     *HTTPConfiguration
	HTTPReqFactory HTTPRequestFactory
	PoolWorkers    int
	DebugLogger    *logging.QueryLogger

	ErrorHandler   func(fallback bool, eventContext *EventContext, err error)
	SuccessHandler func(eventContext *EventContext)
}

//HTTPConfiguration is a dto for HTTP adapter (client) configuration
type HTTPConfiguration struct {
	GlobalClientTimeout time.Duration
	RetryDelay          time.Duration
	RetryCount          int

	ClientMaxIdleConns        int
	ClientMaxIdleConnsPerHost int
}

//HTTPAdapter is an adapter for sending HTTP requests with retries
//has persistent request queue and workers pool under the hood
type HTTPAdapter struct {
	client         *http.Client
	workersPool    *ants.PoolWithFunc
	queue          *PersistentQueue
	debugLogger    *logging.QueryLogger
	httpReqFactory HTTPRequestFactory

	errorHandler   func(fallback bool, eventContext *EventContext, err error)
	successHandler func(eventContext *EventContext)

	destinationID string
	retryCount    int
	retryDelay    time.Duration
	closed        bool
}

//NewHTTPAdapter returns configured HTTPAdapter and starts queue observing goroutine
func NewHTTPAdapter(config *HTTPAdapterConfiguration) (*HTTPAdapter, error) {
	httpAdapter := &HTTPAdapter{
		client: &http.Client{
			Timeout: config.HTTPConfig.GlobalClientTimeout,
			Transport: &http.Transport{
				MaxIdleConns:        config.HTTPConfig.ClientMaxIdleConns,
				MaxIdleConnsPerHost: config.HTTPConfig.ClientMaxIdleConnsPerHost,
			},
		},
		debugLogger:    config.DebugLogger,
		httpReqFactory: config.HTTPReqFactory,

		errorHandler:   config.ErrorHandler,
		successHandler: config.SuccessHandler,

		destinationID: config.DestinationID,
		retryCount:    config.HTTPConfig.RetryCount,
		retryDelay:    config.HTTPConfig.RetryDelay,
	}

	reqQueue, err := NewPersistentQueue("http_queue.dst="+config.DestinationID, config.Dir)
	if err != nil {
		httpAdapter.client.CloseIdleConnections()
		return nil, err
	}

	pool, err := ants.NewPoolWithFunc(config.PoolWorkers, httpAdapter.sendRequestWithRetry)
	if err != nil {
		return nil, fmt.Errorf("Error creating HTTP adapter workers pool: %v", err)
	}

	httpAdapter.workersPool = pool
	httpAdapter.queue = reqQueue

	httpAdapter.startObserver()

	return httpAdapter, nil
}

//startObserver run goroutine for polling from the queue and executes Request
func (h *HTTPAdapter) startObserver() {
	safego.RunWithRestart(func() {
		for {
			if h.closed {
				break
			}

			if h.workersPool.Free() > 0 {
				queuedRequest, err := h.queue.DequeueBlock()
				if err != nil {
					if err == events.ErrQueueClosed && h.closed {
						continue
					}

					logging.SystemErrorf("[%s] Error reading HTTP request from the queue: %v", h.destinationID, err)
					continue
				}

				//dequeued request was from retry call and retry timeout hasn't come
				if time.Now().UTC().Before(queuedRequest.DequeuedTime) {
					if err := h.queue.AddRequest(queuedRequest); err != nil {
						logging.SystemErrorf("[%s] Error enqueueing HTTP request after dequeuing: %v", h.destinationID, err)
						h.errorHandler(true, queuedRequest.EventContext, err)
					}

					continue
				}

				if err := h.workersPool.Invoke(queuedRequest); err != nil {
					if err != ants.ErrPoolClosed {
						logging.SystemErrorf("[%s] Error invoking HTTP request task: %v", h.destinationID, err)
					}

					if err := h.queue.AddRequest(queuedRequest); err != nil {
						logging.SystemErrorf("[%s] Error enqueueing HTTP request after invoking: %v", h.destinationID, err)
						h.errorHandler(true, queuedRequest.EventContext, err)
					}
				}
			}
		}
	})
}

//SendAsync puts request to the queue
//returns err if can't put to the queue
func (h *HTTPAdapter) SendAsync(eventContext *EventContext) error {
	httpReq, err := h.httpReqFactory.Create(eventContext.ProcessedEvent)
	if err != nil {
		return err
	}

	return h.queue.Add(httpReq, eventContext)
}

func (h *HTTPAdapter) sendRequestWithRetry(i interface{}) {
	queuedRequest, ok := i.(*QueuedRequest)
	if !ok {
		logging.SystemErrorf("HTTP webhook request has unknown type: %T", i)
		return
	}

	retries := ""
	if queuedRequest.Retry > 0 {
		retries = fmt.Sprintf(" with %d retry", queuedRequest.Retry)
	}

	debugQuery := fmt.Sprintf("%s %s. Headers: %v %s", queuedRequest.HTTPReq.Method, queuedRequest.HTTPReq.URL, queuedRequest.HTTPReq.Header, retries)

	var values []interface{}
	//copying req body if not nil
	body := queuedRequest.HTTPReq.Body
	if body != nil {
		bodyReader, err := queuedRequest.HTTPReq.GetBody()
		if err != nil {
			logging.Errorf("Error copying HTTP body for debug logs: %v", err)
		} else {
			b, _ := ioutil.ReadAll(bodyReader)
			values = append(values, string(b))
		}
	}

	h.debugLogger.LogQueryWithValues(debugQuery, values)

	err := h.doRequest(queuedRequest.HTTPReq)
	if err != nil {
		h.doRetry(queuedRequest, err)
	} else {
		h.successHandler(queuedRequest.EventContext)
	}
}

func (h *HTTPAdapter) doRetry(queuedRequest *QueuedRequest, sendErr error) {
	if queuedRequest.Retry < h.retryCount {
		queuedRequest.Retry += 1
		queuedRequest.DequeuedTime = time.Now().UTC().Add(h.retryDelay)
		if err := h.queue.AddRequest(queuedRequest); err != nil {
			logging.SystemErrorf("[%s] Error enqueueing HTTP request after sending: %v", h.destinationID, err)
			h.errorHandler(true, queuedRequest.EventContext, sendErr)
		} else {
			h.errorHandler(false, queuedRequest.EventContext, sendErr)
		}
		return
	}

	reqJson, _ := json.Marshal(queuedRequest)
	logging.Errorf("[%s] Error sending HTTP request [%s]: %v", h.destinationID, string(reqJson), sendErr)

	h.errorHandler(true, queuedRequest.EventContext, sendErr)
}

func (h *HTTPAdapter) doRequest(httpReq *http.Request) error {
	resp, err := h.client.Do(httpReq)
	if err != nil {
		return err
	}

	var responsePayload string
	if resp != nil && resp.Body != nil {
		defer resp.Body.Close()

		responseBody, err := ioutil.ReadAll(resp.Body)
		if err != nil {
			responsePayload = fmt.Sprintf("[%s] Error reading HTTP response body: %v", h.destinationID, err)
		} else {
			responsePayload = string(responseBody)
		}
	}

	headers, _ := json.Marshal(resp.Header)

	if resp.StatusCode >= 200 && resp.StatusCode <= 299 {
		return fmt.Errorf("HTTP Response status code: [%d], Response body: [%s], Response headers: [%s]", resp.StatusCode, responsePayload, string(headers))
	}

	return nil
}

//Close closes underlying queue, workers pool and HTTP client
//returns err if occurred
func (h *HTTPAdapter) Close() (err error) {
	h.closed = true
	err = h.queue.Close()

	h.workersPool.Release()
	h.client.CloseIdleConnections()

	return err
}
