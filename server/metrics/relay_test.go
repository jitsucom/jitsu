package metrics_test

import (
	"context"
	"encoding/json"
	"fmt"
	"mime"
	"net/http"
	"sync"
	"testing"
	"time"

	"github.com/jitsucom/jitsu/server/metrics"
	"github.com/phayes/freeport"
	"github.com/pkg/errors"
	"github.com/prometheus/client_golang/prometheus"
	"github.com/stretchr/testify/assert"
)

func runMockServer(t *testing.T, work *sync.WaitGroup, handler func(metrics.RelayData)) (string, error) {
	port, err := freeport.GetFreePort()
	if err != nil {
		return "", errors.Wrap(err, "get free port")
	}

	address := fmt.Sprintf("localhost:%d", port)

	go http.ListenAndServe(address, http.HandlerFunc(func(rw http.ResponseWriter, r *http.Request) {
		defer work.Done()

		mediaType, _, err := mime.ParseMediaType(r.Header.Get("Content-Type"))
		assert.Equal(t, http.MethodPost, r.Method, "http method")
		assert.Nil(t, err, "parse content type header error")
		assert.Equal(t, "application/json", mediaType, "request media type")

		if !assert.NotNil(t, r.Body, "request body is empty") {
			return
		}

		var data metrics.RelayData
		err = json.NewDecoder(r.Body).Decode(&data)
		if !assert.Nil(t, err, "decode request json body error") {
			return
		}

		handler(data)
	}))

	return "http://" + address, nil
}

func TestRelay_Relay(t *testing.T) {
	registry := prometheus.NewRegistry()
	counter := prometheus.NewCounter(prometheus.CounterOpts{
		Namespace: "namespace0",
		Subsystem: "subsystem0",
		Name:      "counter0",
	})

	registry.MustRegister(counter)
	counter.Add(10)
	gatheredData, err := registry.Gather()
	if !assert.Nil(t, err, "gather registry data error") {
		return
	}

	hostID := "host0"
	deploymentID := "deployment0"
	now := time.Now()
	gatheredData[0].Metric[0].Label = nil
	expectedData := metrics.RelayData{
		Timestamp:    now.UnixMilli(),
		HostID:       hostID,
		DeploymentID: deploymentID,
		Data:         gatheredData,
	}

	work := new(sync.WaitGroup)
	work.Add(1)
	address, err := runMockServer(t, work, func(actualData metrics.RelayData) {
		assert.Equal(t, expectedData, actualData)
	})

	if !assert.Nil(t, err, "run mock server error") {
		return
	}

	relay := &metrics.Relay{
		URL:          address,
		HostID:       hostID,
		DeploymentID: deploymentID,
		Timeout:      time.Second,
	}

	err = relay.Relay(context.Background(), now, registry)
	if !assert.Nil(t, err, "relay metrics error") {
		return
	}

	work.Wait()
}

type manualTrigger struct {
	C   chan time.Time
	now time.Time
}

func newManualTrigger(now time.Time) *manualTrigger {
	return &manualTrigger{
		C:   make(chan time.Time),
		now: now,
	}
}

func (t *manualTrigger) Trigger()                  { t.C <- t.now }
func (t *manualTrigger) Channel() <-chan time.Time { return t.C }
func (t *manualTrigger) Now() time.Time            { return t.now }
func (t *manualTrigger) Stop()                     { close(t.C) }

func TestRelay_Run_Stop(t *testing.T) {
	registry := prometheus.NewRegistry()

	hostID := "host0"
	deploymentID := "deployment0"

	now := time.Now()
	work := new(sync.WaitGroup)
	// we trigger relay 4 times and the fifth is final on Stop
	work.Add(5)
	address, err := runMockServer(t, work, func(actualData metrics.RelayData) {
		// simply check that the requests are there via sync.WaitGroup
		assert.Equal(t, now.UnixMilli(), actualData.Timestamp, "relay data timestamp")
	})

	if !assert.Nil(t, err, "run mock server error") {
		return
	}

	relay := &metrics.Relay{
		URL:          address,
		HostID:       hostID,
		DeploymentID: deploymentID,
		Timeout:      time.Second,
	}

	trigger := newManualTrigger(now)
	relay.Run(context.Background(), trigger, registry)
	for i := 0; i < 4; i++ {
		trigger.Trigger()
	}

	relay.Stop()
	work.Wait()
}
