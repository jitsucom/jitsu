package metrics

import (
	"context"
	"net/http"
	"time"

	"github.com/jfk9w-go/flu"
	"github.com/jfk9w-go/flu/httpf"
	"github.com/jitsucom/jitsu/server/logging"
	"github.com/pkg/errors"
	"github.com/prometheus/client_golang/prometheus"
	"github.com/prometheus/client_golang/prometheus/collectors"
	dto "github.com/prometheus/client_model/go"
)

type ScrapeData struct {
	Timestamp      time.Time           `json:"timestamp"`
	HostID         string              `json:"hostId"`
	DeploymentID   string              `json:"deploymentId"`
	MetricFamilies []*dto.MetricFamily `json:"metricFamilies"`
}

type ScrapeConfig struct {
	HostID       string
	DeploymentID string
	ScrapeURL    string
	Interval     time.Duration
	Timeout      time.Duration
}

type Registry struct {
	prometheus.Registerer

	gatherer   prometheus.Gatherer
	httpClient *httpf.Client
	cancel     func()
	work       flu.WaitGroup
}

func NewRegistry() *Registry {
	registry := prometheus.NewRegistry()
	registry.MustRegister(
		collectors.NewProcessCollector(collectors.ProcessCollectorOpts{}),
		collectors.NewGoCollector(),
	)

	return &Registry{
		Registerer: registry,
		httpClient: httpf.NewClient(nil),
		gatherer:   registry,
	}
}

func (r *Registry) NewCounterVec(opts prometheus.CounterOpts, labels []string) *prometheus.CounterVec {
	vec := prometheus.NewCounterVec(opts, labels)
	r.MustRegister(vec)
	return vec
}

func (r *Registry) NewGaugeVec(opts prometheus.GaugeOpts, labels []string) *prometheus.GaugeVec {
	vec := prometheus.NewGaugeVec(opts, labels)
	r.MustRegister(vec)
	return vec
}

func (r *Registry) ScrapeEvery(ctx context.Context, config *ScrapeConfig) {
	if r.cancel != nil {
		r.cancel()
		r.work.Wait()
		r.cancel = nil
		r.work = flu.WaitGroup{}
	}

	r.cancel = r.work.Go(ctx, func(ctx context.Context) {
		// scrape final metrics state on shutdown
		defer func() { _ = r.scrape(context.Background(), time.Now(), config) }()
		ticker := time.NewTicker(config.Interval)
		defer ticker.Stop()
		for {
			select {
			case now := <-ticker.C:
				if err := r.scrape(ctx, now, config); err != nil {
					if ctx.Err() != nil {
						return
					}

					logging.Warnf("Error sending collected usage data")
				}

			case <-ctx.Done():
				return
			}
		}
	})
}

func (r *Registry) Stop() {
	if r.cancel != nil {
		r.cancel()
		r.work.Wait()
	}
}

func (r *Registry) scrape(ctx context.Context, now time.Time, config *ScrapeConfig) error {
	metricFamilies, err := r.gatherer.Gather()
	if err != nil {
		return errors.Wrap(err, "gather metrics")
	}

	ctx, cancel := context.WithTimeout(ctx, config.Timeout)
	defer cancel()

	if err := r.httpClient.POST(config.ScrapeURL).
		Context(ctx).
		BodyEncoder(flu.JSON(ScrapeData{
			Timestamp:      now,
			HostID:         config.HostID,
			DeploymentID:   config.DeploymentID,
			MetricFamilies: metricFamilies,
		})).
		Execute().
		CheckStatus(http.StatusOK).
		Error; err != nil {
		return errors.Wrap(err, "send metrics")
	}

	return nil
}
