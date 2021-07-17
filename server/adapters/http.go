package adapters

import (
	"bytes"
	"encoding/json"
	"fmt"
	"github.com/jitsucom/jitsu/server/logging"
	"github.com/jitsucom/jitsu/server/safego"
	"github.com/panjf2000/ants/v2"
	"go.uber.org/atomic"
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
	closed        *atomic.Bool
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
		closed:        atomic.NewBool(false),
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
			if h.closed.Load() {
				break
			}

			if h.workersPool.Free() > 0 {
				retryableRequest, err := h.queue.DequeueBlock()
				if err != nil {
					if err == ErrQueueClosed && h.closed.Load() {
						continue
					}

					logging.SystemErrorf("[%s] Error reading HTTP request from the queue: %v", h.destinationID, err)
					continue
				}

				//dequeued request was from retry call and retry timeout hasn't come
				if time.Now().UTC().Before(retryableRequest.DequeuedTime) {
					if err := h.queue.AddRequest(retryableRequest); err != nil {
						logging.SystemErrorf("[%s] Error enqueueing HTTP request after dequeuing: %v", h.destinationID, err)
						h.errorHandler(true, retryableRequest.EventContext, err)
					}

					continue
				}

				if err := h.workersPool.Invoke(retryableRequest); err != nil {
					if err != ants.ErrPoolClosed {
						logging.SystemErrorf("[%s] Error invoking HTTP request task: %v", h.destinationID, err)
					}

					if err := h.queue.AddRequest(retryableRequest); err != nil {
						logging.SystemErrorf("[%s] Error enqueueing HTTP request after invoking: %v", h.destinationID, err)
						h.errorHandler(true, retryableRequest.EventContext, err)
					}
				}
			}
		}
	})
}

//SendAsync puts request to the queue
//returns err if can't put to the queue
func (h *HTTPAdapter) SendAsync(eventContext *EventContext) error {
	req, err := h.httpReqFactory.Create(eventContext.ProcessedEvent)
	if err != nil {
		return err
	}

	return h.queue.Add(req, eventContext)
}

func (h *HTTPAdapter) sendRequestWithRetry(i interface{}) {
	retryableRequest, ok := i.(*RetryableRequest)
	if !ok {
		logging.SystemErrorf("HTTP webhook request has unknown type: %T", i)
		return
	}

	retries := ""
	if retryableRequest.Retry > 0 {
		retries = fmt.Sprintf(" with %d retry", retryableRequest.Retry)
	}

	debugQuery := fmt.Sprintf("%s %s. Headers: %v %s", retryableRequest.Request.Method, retryableRequest.Request.URL, retryableRequest.Request.Headers, retries)

	h.debugLogger.LogQueryWithValues(debugQuery, []interface{}{string(retryableRequest.Request.Body)})

	err := h.doRequest(retryableRequest.Request)
	if err != nil {
		h.doRetry(retryableRequest, err)
	} else {
		h.successHandler(retryableRequest.EventContext)
	}
}

func (h *HTTPAdapter) doRetry(retryableRequest *RetryableRequest, sendErr error) {
	if retryableRequest.Retry < h.retryCount {
		retryableRequest.Retry += 1
		retryableRequest.DequeuedTime = time.Now().UTC().Add(h.retryDelay)
		if err := h.queue.AddRequest(retryableRequest); err != nil {
			logging.SystemErrorf("[%s] Error enqueueing HTTP request after sending: %v", h.destinationID, err)
			h.errorHandler(true, retryableRequest.EventContext, sendErr)
		} else {
			h.errorHandler(false, retryableRequest.EventContext, sendErr)
		}
		return
	}

	headersJSON, _ := json.Marshal(retryableRequest.Request.Headers)
	logging.Errorf("[%s] Error sending HTTP request URL: [%s] Method: [%s] Body: [%s] Headers: [%s]: %v", h.destinationID, retryableRequest.Request.URL, retryableRequest.Request.Method, string(retryableRequest.Request.Body), headersJSON, sendErr)

	h.errorHandler(true, retryableRequest.EventContext, sendErr)
}

func (h *HTTPAdapter) doRequest(req *Request) error {
	var httpReq *http.Request
	var err error
	if req.Body != nil && len(req.Body) > 0 {
		httpReq, err = http.NewRequest(req.Method, req.URL, bytes.NewReader(req.Body))
	} else {
		httpReq, err = http.NewRequest(req.Method, req.URL, nil)
	}

	if err != nil {
		return err
	}

	for header, value := range req.Headers {
		httpReq.Header.Add(header, value)
	}

	resp, err := h.client.Do(httpReq)
	if err != nil {
		return err
	}

	if resp != nil && resp.Body != nil {
		defer resp.Body.Close()
	}

	//check HTTP response code
	if resp.StatusCode < 200 || resp.StatusCode > 299 {
		//read response body
		responsePayload := "no HTTP response body"
		if resp != nil && resp.Body != nil {
			responseBody, err := ioutil.ReadAll(resp.Body)
			if err != nil {
				responsePayload = fmt.Sprintf("[%s] Error reading HTTP response body: %v", h.destinationID, err)
			} else {
				responsePayload = string(responseBody)
			}
		}

		headers, _ := json.MarshalIndent(resp.Header, " ", " ")

		return fmt.Errorf("HTTP Response status code: [%d],\n\tResponse body: [%s],\n\tResponse headers: [%s]", resp.StatusCode, responsePayload, string(headers))
	}

	return nil
}

//Close closes underlying queue, workers pool and HTTP client
//returns err if occurred
func (h *HTTPAdapter) Close() (err error) {
	h.closed.Store(true)
	err = h.queue.Close()

	h.workersPool.Release()
	h.client.CloseIdleConnections()

	return err
}
