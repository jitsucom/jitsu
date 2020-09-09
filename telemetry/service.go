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
}

func Init(commit, tag, builtAt string, usageOptOut bool) {
	instance = Service{
		reqFactory: newRequestFactory(commit, tag, builtAt),
		client: &http.Client{
			Timeout: 30 * time.Second,
			Transport: &http.Transport{
				MaxIdleConns:        1000,
				MaxIdleConnsPerHost: 1000,
			},
		},
		url:         "https://tracker.ksense.io/api/v1/s2s/event?token=ttttd50c-d8f2-414c-bf3d-9902a5031fd2",
		usageOptOut: usageOptOut,

		usageCh: make(chan *Request, 10_000_000),
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
		}
	}()
}
