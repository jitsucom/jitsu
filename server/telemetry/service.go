package telemetry

import (
	"bytes"
	"encoding/json"
	"github.com/jitsucom/jitsu/server/resources"
	"github.com/jitsucom/jitsu/server/safego"
	"github.com/spf13/viper"
	"go.uber.org/atomic"
	"net/http"
	"time"
)

var reloadEvery = 20 * time.Second

//Configuration dto for telemetry enable/disable configuration
type Configuration struct {
	Disabled map[string]bool `json:"disabled,omitempty"`
}

var instance Service

//Service is used for sending telemetry
type Service struct {
	reqFactory *RequestFactory
	client     *http.Client
	url        string

	usageOptOut *atomic.Bool

	collector *EventsCollector
	usageCh   chan *Request

	flushCh chan bool
	closed  bool
}

//InitTest for tests only
func InitTest() {
	instance = Service{usageOptOut: atomic.NewBool(true)}
}

//InitFromViper creates telemetry instance, starts goroutine
//if configuration is provided as a url - starts another goroutine (see resources.Watch)
func InitFromViper(serviceName, commit, tag, builtAt string) {
	Init(serviceName, commit, tag, builtAt)

	telemetrySourceURL := viper.GetString("server.telemetry")
	if telemetrySourceURL != "" {
		resources.Watch(serviceName, telemetrySourceURL, resources.LoadFromHTTP, reInit, reloadEvery)
	} else {
		instance.usageOptOut = atomic.NewBool(viper.GetBool("server.telemetry.disabled.usage"))
	}
}

//Init creates telemetry instance and starts goroutine
func Init(serviceName, commit, tag, builtAt string) {
	instance = Service{
		reqFactory: newRequestFactory(serviceName, commit, tag, builtAt),
		client: &http.Client{
			Timeout: 30 * time.Second,
			Transport: &http.Transport{
				MaxIdleConns:        1000,
				MaxIdleConnsPerHost: 1000,
			},
		},
		url:         "https://t.jitsu.com/api/v1/s2s/event?token=ttttd50c-d8f2-414c-bf3d-9902a5031fd2",
		usageOptOut: atomic.NewBool(false),

		collector: NewEventsCollector(),

		usageCh: make(chan *Request, 100),

		flushCh: make(chan bool, 1),
	}

	instance.startUsage()
}

//reInit initializes telemetry configuration
//it is used in case of reloadable telemetry configuration (when configuration is provided as a url)
func reInit(payload []byte) {
	c := &Configuration{}
	err := json.Unmarshal(payload, c)
	if err != nil {
		return
	}

	if c.Disabled != nil {
		optOut, ok := c.Disabled["usage"]
		if ok {
			if instance.usageOptOut == nil {
				instance.usageOptOut = atomic.NewBool(false)
			}

			instance.usageOptOut.Store(optOut)
		}
	}
}

//ServerStart puts server start event into the queue
func ServerStart() {
	instance.usage(&Usage{ServerStart: 1})
}

//ServerStop puts server stop event into the queue
func ServerStop() {
	instance.usage(&Usage{ServerStop: 1})
}

//Event increment events collector counter
func Event(src string) {
	if !instance.usageOptOut.Load() {
		instance.collector.Event(src)
	}
}

//User puts user request into the queue
//it is used in manager
func User(user *UserData) {
	instance.usageCh <- instance.reqFactory.fromUser(user)
}

func (s *Service) usage(usage *Usage) {
	if !s.usageOptOut.Load() {
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
				s.enqueueUsage()
			case <-s.flushCh:
				s.enqueueUsage()
			}
		}
	})

	safego.RunWithRestart(func() {
		for {
			if instance.closed {
				break
			}

			//wait until configuration is changed
			if instance.usageOptOut.Load() {
				time.Sleep(reloadEvery)
				continue
			}

			req := <-s.usageCh
			if b, err := json.Marshal(req); err == nil {
				s.client.Post(s.url, "application/json", bytes.NewBuffer(b))
			}
		}
	})
}

func (s *Service) enqueueUsage() {
	eventsPerSrc := s.collector.Cut()
	for src, eventsCount := range eventsPerSrc {
		instance.usage(&Usage{Events: eventsCount, EventsSrc: src})
	}
}

//Flush sends all requests that are in a queue
func Flush() {
	instance.flushCh <- true
}

//Close stopes underline goroutines
func Close() {
	instance.closed = true
}
