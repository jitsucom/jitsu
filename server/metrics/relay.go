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

type Relay struct {
	URL          string
	HostID       string
	DeploymentID string
	Interval     time.Duration
	Timeout      time.Duration
	work         sync.WaitGroup
	cancel       func()
}

func (r *Relay) Run(ctx context.Context, gatherer prometheus.Gatherer) {
	r.Stop()
	ctx, cancel := context.WithCancel(ctx)
	r.cancel = cancel
	r.work.Add(1)
	go func() {
		defer func() {
			r.cancel()
			r.work.Done()
		}()

		// scrape final metrics state on shutdown
		defer func() { _ = r.Relay(context.Background(), time.Now(), gatherer) }()
		ticker := time.NewTicker(r.Interval)
		defer ticker.Stop()
		for {
			select {
			case now := <-ticker.C:
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

type relayData struct {
	Timestamp    time.Time           `json:"timestamp"`
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
		BodyJSON(relayData{
			Timestamp:    now,
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
