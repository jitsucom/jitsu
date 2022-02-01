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

	"github.com/jitsucom/jitsu/server/safego"

	"github.com/jitsucom/jitsu/server/metrics"
	"github.com/jitsucom/jitsu/server/resources"
	"github.com/jitsucom/jitsu/server/timestamp"
	"github.com/phayes/freeport"
	"github.com/pkg/errors"
	"github.com/prometheus/client_golang/prometheus"
	"github.com/stretchr/testify/assert"
)

type RelayDataHandlerFunc func(actualData metrics.RelayData)

type mockServer struct {
	*http.Server
	handler RelayDataHandlerFunc
	work    *sync.WaitGroup
}

func runMockServer(t *testing.T) (*mockServer, error) {
	port, err := freeport.GetFreePort()
	if err != nil {
		return nil, errors.Wrap(err, "get free port")
	}

	mock := new(mockServer)
	server := &http.Server{
		Addr: fmt.Sprintf("localhost:%d", port),
		Handler: http.HandlerFunc(func(rw http.ResponseWriter, r *http.Request) {
			defer mock.work.Done()

			mediaType, _, err := mime.ParseMediaType(r.Header.Get("Content-Type"))
			assert.Equal(t, http.MethodPost, r.Method, "http method")
			assert.Nil(t, err, "parse content type header error")
			assert.Equal(t, "application/json", mediaType, "request media type")

			if !assert.NotNil(t, r.Body, "request body is empty") {
				return
			}

			defer r.Body.Close()
			var data metrics.RelayData
			err = json.NewDecoder(r.Body).Decode(&data)
			if !assert.Nil(t, err, "decode request json body error") {
				return
			}

			mock.handler(data)
		}),
	}

	safego.Run(func() { _ = server.ListenAndServe() })
	mock.Server = server
	return mock, nil
}

func (mock *mockServer) Handle(work *sync.WaitGroup, handler RelayDataHandlerFunc) {
	mock.work = work
	mock.handler = handler
}

func TestRelay_Relay(t *testing.T) {
	timestamp.FreezeTime()
	defer timestamp.UnfreezeTime()

	sourceID := "source_id0"
	destinationID := "destination_id0"
	registry := prometheus.NewRegistry()
	counterVec := prometheus.NewCounterVec(prometheus.CounterOpts{
		Namespace: "namespace0",
		Subsystem: "subsystem0",
		Name:      "counter0",
	}, []string{"source_type", "source_id", "destination_type", "destination_id"})
	registry.MustRegister(counterVec)
	counterVec.WithLabelValues("source_type0", sourceID, "destination_type0", destinationID).Add(10)

	gatheredData, err := registry.Gather()
	if !assert.Nil(t, err, "gather registry data error") {
		return
	}

	preparedData, err := metrics.CloneMetricData(gatheredData)
	if !assert.Nil(t, err, "clone metric data") {
		return
	}

	hostID := "host0"
	deploymentID := "deployment0"

	// respecting privacy here
	for _, label := range preparedData[0].Metric[0].Label {
		if *label.Name == "source_id" || *label.Name == "destination_id" {
			*label.Value = resources.GetStringHash(*label.Value)
		}
	}

	expectedData := metrics.RelayData{
		Timestamp:    timestamp.Now().UnixMilli(),
		HostID:       hostID,
		DeploymentID: deploymentID,
		Data:         preparedData,
	}

	work := new(sync.WaitGroup)
	work.Add(1)
	server, err := runMockServer(t)
	if !assert.Nil(t, err, "run mock server error") {
		return
	}

	defer server.Close()
	server.Handle(work, func(actualData metrics.RelayData) { assert.Equal(t, expectedData, actualData) })

	relay := &metrics.Relay{
		URL:          "http://" + server.Addr,
		HostID:       hostID,
		DeploymentID: deploymentID,
		Timeout:      time.Second,
	}

	err = relay.Relay(context.Background(), registry)
	if !assert.Nil(t, err, "relay metrics error") {
		return
	}

	work.Wait()
}

type manualTrigger struct {
	C chan time.Time
}

func newManualTrigger() *manualTrigger {
	return &manualTrigger{
		C: make(chan time.Time),
	}
}

func (t *manualTrigger) Trigger()                  { t.C <- time.Time{} }
func (t *manualTrigger) Channel() <-chan time.Time { return t.C }
func (t *manualTrigger) Stop()                     { close(t.C) }

func TestRelay_Run_Stop(t *testing.T) {
	timestamp.FreezeTime()
	defer timestamp.UnfreezeTime()

	registry := prometheus.NewRegistry()
	hostID := "host0"
	deploymentID := "deployment0"

	server, err := runMockServer(t)
	if !assert.Nil(t, err, "run mock server error") {
		return
	}

	defer server.Close()
	work := new(sync.WaitGroup)
	work.Add(4)
	server.Handle(work, func(actualData metrics.RelayData) {
		assert.Equal(t, timestamp.Now().UnixMilli(), actualData.Timestamp, "relay data timestamp")
	})

	relay := &metrics.Relay{
		URL:          "http://" + server.Addr,
		HostID:       hostID,
		DeploymentID: deploymentID,
		Timeout:      time.Second,
	}

	trigger := newManualTrigger()
	relay.Run(context.Background(), trigger, registry)
	for i := 0; i < 4; i++ {
		trigger.Trigger()
	}

	work.Wait()

	work = new(sync.WaitGroup)
	work.Add(1)
	server.Handle(work, func(actualData metrics.RelayData) {
		assert.Equal(t, timestamp.Now().UnixMilli(), actualData.Timestamp, "relay data timestamp")
	})

	relay.Stop()
	work.Wait()
}
