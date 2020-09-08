package telemetry

import (
	"bytes"
	"net/http"
	"time"
)

var instance Service

type Service struct {
	reqFactory *RequestFactory
	client     *http.Client
	url        string

	usageOptOut bool

	usageCh chan *Request
	/*usageSkipped int64
	usageErrors  int64

	errorCh      chan *Request
	errorSkipped int64
	errorErrors  int64*/
}

func Init(commit, tag, builtAt string, usageOptOut bool) {
	instance = Service{
		reqFactory: newRequestFactory(commit, tag, builtAt),
		client: &http.Client{
			Timeout: 15 * time.Second,
			Transport: &http.Transport{
				//TLSClientConfig:     &tls.Config{InsecureSkipVerify: true},
				MaxIdleConns:        1000,
				MaxIdleConnsPerHost: 1000,
			},
		},
		url:         "https://tracker.ksense.io/api/v1/s2s/event?token=ttttd50c-d8f2-414c-bf3d-9902a5031fd2",
		usageOptOut: usageOptOut,

		usageCh: make(chan *Request, 10_000_000),
		/*usageSkipped: 0,
		usageErrors:  0,

		errorCh:      make(chan *Request, 10_000_000),
		errorSkipped: 0,
		errorErrors:  0,*/
	}

	if !usageOptOut {
		instance.startUsage()
	}
}

func ServerStart() {
	instance.usage(&Usage{ServerStart: 1})
}

func ServerStop() {
	instance.usage(&Usage{ServerStop: 1})
}

func (s *Service) usage(usage *Usage) {
	if !s.usageOptOut {
		select {
		case instance.usageCh <- instance.reqFactory.fromUsage(usage):
		default:
			//atomic.AddInt64(&instance.usageSkipped, 1)
		}
	}
}

func (s *Service) startUsage() {
	go func() {
		for {
			req := <-s.usageCh
			if b, err := req.MarshalJSON(); err != nil {
				s.client.Post(s.url, "application/json", bytes.NewBuffer(b))
			}
			/*r, err := s.client.Post(s.url, "application/json", bytes.NewBuffer())
			if err != nil || r == nil || r.StatusCode != 200 {
				atomic.AddInt64(&s.usageErrors, 1)
			}*/
		}
	}()
}
