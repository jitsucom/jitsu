package metrics

import (
	"context"
	"net/http"
	"sync"
	"time"

	"github.com/carlmjohnson/requests"
	"github.com/jitsucom/jitsu/server/logging"
	"github.com/jitsucom/jitsu/server/resources"
	"github.com/jitsucom/jitsu/server/safego"
	"github.com/jitsucom/jitsu/server/timestamp"
	"github.com/pkg/errors"
	"github.com/prometheus/client_golang/prometheus"
	dto "github.com/prometheus/client_model/go"
)

var HashedRelayLabels = map[string]bool{
	"source_id":      true,
	"destination_id": true,
}

type RelayTrigger interface {
	// Channel must return a channel which is emitted values to.
	// Don't want to start a whole new goroutine to convert time.Time to struct{} values for TickerTrigger.
	// Let's just say that the channel values are ignored.
	Channel() <-chan time.Time
	Stop()
}

type TickerTrigger struct {
	*time.Ticker
}

func (t TickerTrigger) Channel() <-chan time.Time {
	return t.C
}

type Relay struct {
	URL          string
	HostID       string
	DeploymentID string
	Timeout      time.Duration
	work         sync.WaitGroup
	cancel       func()
}

func (r *Relay) Run(rootCtx context.Context, trigger RelayTrigger, gatherer prometheus.Gatherer) {
	r.Stop()
	ctx, cancel := context.WithCancel(rootCtx)
	r.cancel = cancel
	r.work.Add(1)
	safego.Run(func() {
		defer func() {
			trigger.Stop()
			_ = r.Relay(rootCtx, gatherer) // scrape final metrics state on shutdown
			r.cancel()
			r.work.Done()
		}()

		for {
			select {
			case <-trigger.Channel():
				if err := r.Relay(ctx, gatherer); err != nil {
					if ctx.Err() != nil {
						return
					}

					logging.Debugf("Error sending collected usage data: %s", err)
				}

			case <-ctx.Done():
				return
			}
		}
	})
}

func (r *Relay) Stop() {
	if r.cancel != nil {
		r.cancel()
		r.work.Wait()
		r.cancel = nil
		r.work = sync.WaitGroup{}
	}
}

type RelayData struct {
	Timestamp    int64               `json:"timestamp"`
	HostID       string              `json:"hostId"`
	DeploymentID string              `json:"deploymentId"`
	Data         []*dto.MetricFamily `json:"data"`
}

func (r *Relay) Relay(ctx context.Context, gatherer prometheus.Gatherer) error {
	data, err := gatherer.Gather()
	if err != nil {
		return errors.Wrap(err, "gather metrics")
	}

	for _, metricFamily := range data {
		for _, metric := range metricFamily.Metric {
			for _, label := range metric.Label {
				if label.Name == nil || label.Value == nil || !HashedRelayLabels[*label.Name] {
					continue
				}

				hashedValue := resources.GetStringHash(*label.Value)
				label.Value = &hashedValue
			}
		}
	}

	ctx, cancel := context.WithTimeout(ctx, r.Timeout)
	defer cancel()

	if err := requests.URL(r.URL).
		Method(http.MethodPost).
		BodyJSON(RelayData{
			Timestamp:    timestamp.Now().UnixMilli(),
			HostID:       r.HostID,
			DeploymentID: r.DeploymentID,
			Data:         data,
		}).
		CheckStatus(http.StatusOK).
		Fetch(ctx); err != nil {
		return errors.Wrap(err, "send metrics")
	}

	return nil
}
