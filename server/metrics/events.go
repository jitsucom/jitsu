package metrics

import (
	"github.com/prometheus/client_golang/prometheus"
	"github.com/prometheus/client_golang/prometheus/promauto"
)

var eventsRedisLabels = []string{"error_type"}

var (
	eventsRedisErrors *prometheus.CounterVec
)

func initEventsRedis() {
	eventsRedisErrors = promauto.NewCounterVec(prometheus.CounterOpts{
		Namespace: "eventnative",
		Subsystem: "events",
		Name:      "redis",
	}, eventsRedisLabels)
}

func EventsRedisErrors(errorType string) {
	if Enabled {
		eventsRedisErrors.WithLabelValues(errorType).Inc()
	}
}
