package telemetry

import (
	"bytes"
	"encoding/json"
	"github.com/jitsucom/eventnative/logging"
	"github.com/jitsucom/eventnative/safego"
	"github.com/spf13/viper"
	"io/ioutil"
	"net/http"
	"time"
)

type Configuration struct {
	Disabled map[string]bool `json:"disabled,omitempty"`
}

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

func InitFromViper(serviceName, commit, tag, builtAt string) {
	var usageOptOut bool
	telemetrySourceUrl := viper.GetString("server.telemetry")
	if telemetrySourceUrl != "" {
		usageOptOut = extractUsageOptOut(telemetrySourceUrl)
	} else {
		usageOptOut = viper.GetBool("server.telemetry.disabled.usage")
	}

	Init(serviceName, commit, tag, builtAt, usageOptOut)
}

func Init(serviceName, commit, tag, builtAt string, usageOptOut bool) {
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

func User(user *UserData) {
	instance.usageCh <- instance.reqFactory.fromUser(user)
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
			if b, err := json.Marshal(req); err == nil {
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

//from http
func extractUsageOptOut(url string) bool {
	r, err := http.Get(url)
	if r != nil && r.Body != nil {
		defer r.Body.Close()
	}

	if err != nil {
		logging.Debugf("Error getting usage opt out settings: %v", err)
		return false
	}

	content, err := ioutil.ReadAll(r.Body)
	if err != nil {
		logging.Debugf("Error reading usage opt out settings: %v", err)
		return false
	}

	c := &Configuration{}
	err = json.Unmarshal(content, c)
	if err != nil {
		logging.Debugf("Error parsing usage opt out settings: %v", err)
		return false
	}

	if c.Disabled != nil {
		optOut, ok := c.Disabled["usage"]
		if ok {
			return optOut
		}
	}

	return false
}
