package telemetry

import (
	"bytes"
	"github.com/ksensehq/eventnative/safego"
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

	flushCh chan bool
	closed  bool
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
		url:         "https://t.jitsu.com/api/v1/s2s/event?token=ttttd50c-d8f2-414c-bf3d-9902a5031fd2",
		usageOptOut: usageOptOut,

		collector: &Collector{},

		usageCh: make(chan *Request, 100),

		flushCh: make(chan bool, 1),
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
	if !instance.usageOptOut {
		instance.collector.Event()
	}
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
	safego.RunWithRestart(func() {
		for {
			if instance.closed {
				ticker.Stop()
				break
			}

			select {
			case <-ticker.C:
				v := s.collector.Cut()
				if v > 0 {
					instance.usage(&Usage{Events: v})
				}
			case <-s.flushCh:
				v := s.collector.Cut()
				if v > 0 {
					instance.usage(&Usage{Events: v})
				}
			}
		}
	})

	safego.RunWithRestart(func() {
		for {
			if instance.closed {
				break
			}

			req := <-s.usageCh
			if b, err := req.MarshalJSON(); err == nil {
				s.client.Post(s.url, "application/json", bytes.NewBuffer(b))
			}
		}
	})
}

func Flush() {
	instance.flushCh <- true
}

func Close() {
	instance.closed = true
}
