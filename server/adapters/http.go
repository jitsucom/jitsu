package adapters

import (
	"bytes"
	"fmt"
	"io"
	"io/ioutil"
	"net/http"
	"strings"
	"text/template"
	"time"

	"github.com/hashicorp/go-multierror"
	"github.com/jitsucom/jitsu/server/safego"
)

type Request struct {
	Event    map[string]interface{}
	Method   string
	URLTmpl  *template.Template
	BodyTmpl *template.Template
	Headers  map[string]string
	Callback func(object map[string]interface{}, err error)
}

func (r *Request) GetURL() (string, error) {
	var buf bytes.Buffer
	if err := r.URLTmpl.Execute(&buf, r.Event); err != nil {
		return "", fmt.Errorf("Error executing %s template: %v", r.URLTmpl, err)
	}
	return strings.TrimSpace(buf.String()), nil
}

func (r *Request) GetBody() (string, error) {
	var buf bytes.Buffer
	if err := r.BodyTmpl.Execute(&buf, r.Event); err != nil {
		return "", fmt.Errorf("Error executing %s template: %v", r.BodyTmpl, err)
	}
	return strings.TrimSpace(buf.String()), nil
}

type HttpAdapter struct {
	client      *http.Client
	queue       chan *Request
	threadCount int
	stopedChan  chan int
	retryCount  int
	retryTime   time.Duration
	closed      bool
	io.Closer
}

func NewHttpAdapter(timeout, retryTime time.Duration, maxIdleConns, maxIdleConnsPerHost, queueSize, threadCount, retryCount int) *HttpAdapter {
	s := &HttpAdapter{
		client: &http.Client{
			Timeout: timeout,
			Transport: &http.Transport{
				MaxIdleConns:        maxIdleConns,
				MaxIdleConnsPerHost: maxIdleConnsPerHost,
			},
		},
		queue:       make(chan *Request, queueSize),
		stopedChan:  make(chan int, 1),
		threadCount: threadCount,
		retryCount:  retryCount,
		retryTime:   retryTime,
		closed:      false,
	}

	for i := 0; i < threadCount; i++ {
		safego.RunWithRestart(s.sendRequestWorker)
	}

	return s
}

func (h *HttpAdapter) AddRequest(r *Request) {
	h.queue <- r
}

func (h *HttpAdapter) sendRequestWorker() {
	for {
		if h.closed {
			break
		}
		request := <-h.queue
		err := h.sendRequestWithRetry(request)
		if err != nil {
			request.Callback(request.Event, err)
		}
	}
}

func (h *HttpAdapter) sendRequestWithRetry(r *Request) (err error) {
	var multiErr error

	url, err := r.GetURL()
	if err != nil {
		return err
	}

	body, err := r.GetBody()
	if err != nil {
		return err
	}

	for i := 0; i < h.retryCount; i++ {
		_, _, err := h.doRequest(r.Method, url, body, r.Headers)
		if err == nil {
			return nil
		}
		multiErr = multierror.Append(multiErr, err)
		time.Sleep(h.retryTime)
	}
	return multiErr
}

func (h *HttpAdapter) doRequest(method string, url string, body string, headers map[string]string) (code int, respBody []byte, err error) {
	req, err := http.NewRequest(method, url, bytes.NewBuffer([]byte(body)))
	if err != nil {
		return 1, respBody, fmt.Errorf("Can't get request; %v", err)
	}

	if headers != nil {
		for k, v := range headers {
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

	if resp.StatusCode != 200 && resp.StatusCode != 201 {
		return resp.StatusCode, respBody, fmt.Errorf("Response status code: %d", resp.StatusCode)
	}

	return resp.StatusCode, respBody, nil
}

func (h *HttpAdapter) Close() {
	h.closed = true
}
