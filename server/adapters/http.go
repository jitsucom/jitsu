package adapters

import (
	"bytes"
	"fmt"
	"io"
	"io/ioutil"
	"net/http"
	"time"

	"github.com/jitsucom/jitsu/server/safego"
)

type HttpAdapter struct {
	client      *http.Client
	queue       chan *Request
	threadCount int
	stopedChan  chan int
	io.Closer
}

type Request struct {
	Method     string
	URL        string
	Body       string
	Headers    map[string]string
	RetryCount int
	NextDt     time.Time
}

func NewHttpAdapter() *HttpAdapter {
	s := &HttpAdapter{
		client: &http.Client{
			Timeout: 10 * time.Second,
			Transport: &http.Transport{
				MaxIdleConns:        1000,
				MaxIdleConnsPerHost: 1000,
			},
		},
		queue:       make(chan *Request, 1000),
		stopedChan:  make(chan int, 1),
		threadCount: 1,
	}

	for i := 0; i < s.threadCount; i++ {
		safego.RunWithRestart(s.sendRequestWorker)
	}

	return s
}

func (h *HttpAdapter) AddRequest(r *Request) {
	h.queue <- r
}

func (h *HttpAdapter) sendRequestWorker() {
	for {
		select {
		case <-time.After(1 * time.Second):
			request := <-h.queue
			if request.RetryCount < 3 && request.NextDt.Before(time.Now()) {
				code, _, _ := h.sendRequest(request)
				if code != http.StatusOK {
					request.RetryCount++
					request.NextDt = time.Now().Add(1 * time.Second)
					h.AddRequest(request)
				}
			}
		case <-h.stopedChan:
			return
		}
	}
}

func (h *HttpAdapter) sendRequest(r *Request) (code int, respBody []byte, err error) {
	req, err := http.NewRequest(r.Method, r.URL, bytes.NewBuffer([]byte(r.Body)))
	if err != nil {
		return 1, respBody, fmt.Errorf("Can't get request; %v", err)
	}

	if r.Headers != nil {
		for k, v := range r.Headers {
			req.Header.Set(k, v)
		}
	}

	resp, err := h.client.Do(req)
	if err != nil {
		return 0, respBody, err
	}

	respBody, err = ioutil.ReadAll(resp.Body)
	if err != nil {
		return resp.StatusCode, respBody, fmt.Errorf("Can't read response; %v", err)
	}
	defer resp.Body.Close()

	return resp.StatusCode, respBody, nil
}

func (h *HttpAdapter) Close() {
	close(h.stopedChan)
}
