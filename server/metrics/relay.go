package metrics

import (
	"context"
	"net/http"
	"sync"
	"time"

	"github.com/carlmjohnson/requests"
	"github.com/jitsucom/jitsu/server/logging"
	"github.com/pkg/errors"
	"github.com/prometheus/client_golang/prometheus"
	dto "github.com/prometheus/client_model/go"
)

type RelayTrigger interface {
	Channel() <-chan time.Time
	Now() time.Time
	Stop()
}

type TickerTrigger struct {
	*time.Ticker
}

func (t TickerTrigger) Now() time.Time {
	return time.Now()
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

func (r *Relay) Run(ctx context.Context, trigger RelayTrigger, gatherer prometheus.Gatherer) {
	r.Stop()
	ctx, cancel := context.WithCancel(ctx)
	r.cancel = cancel
	r.work.Add(1)
	go func() {
		defer func() {
			trigger.Stop()
			_ = r.Relay(context.Background(), trigger.Now(), gatherer) // scrape final metrics state on shutdown
			r.cancel()
			r.work.Done()
		}()

		for {
			select {
			case now := <-trigger.Channel():
				if err := r.Relay(ctx, now, gatherer); err != nil {
					if ctx.Err() != nil {
						return
					}

					logging.Debugf("Error sending collected usage data: %s", err)
				}

			case <-ctx.Done():
				return
			}
		}
	}()
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

func (r *Relay) Relay(ctx context.Context, now time.Time, gatherer prometheus.Gatherer) error {
	data, err := gatherer.Gather()
	if err != nil {
		return errors.Wrap(err, "gather metrics")
	}

	ctx, cancel := context.WithTimeout(ctx, r.Timeout)
	defer cancel()

	if err := requests.URL(r.URL).
		Method(http.MethodPost).
		BodyJSON(RelayData{
			Timestamp:    now.UnixMilli(),
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
