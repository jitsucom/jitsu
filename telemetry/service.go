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

	collector *Collector
	usageCh   chan *Request

	closed bool
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
		url:         "https://track.ksense.io/api/v1/s2s/event?token=ttttd50c-d8f2-414c-bf3d-9902a5031fd2",
		usageOptOut: usageOptOut,

		collector: &Collector{},

		usageCh: make(chan *Request, 100),
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

func Event() {
	instance.collector.Event()
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
	ticker := time.NewTicker(time.Hour)
	go func() {
		for {
			select {
			case <-ticker.C:
			case close:
				v := s.collector.Cut()
				instance.usage(&Usage{Events: v})
			}
		}
	}()

	go func() {
		for {
			if s.closed {
				break
			}

			req := <-s.usageCh
			if b, err := req.MarshalJSON(); err == nil {
				s.client.Post(s.url, "application/json", bytes.NewBuffer(b))
			}
		}
	}()
}

func Close() {
	instance.closed = true
}
