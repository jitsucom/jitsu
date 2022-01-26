package metrics

import (
	"github.com/prometheus/client_golang/prometheus"
)

var coordinationRedisLabels = []string{"error_type"}

var (
	coordinationRedisErrors *prometheus.CounterVec
)

func initCoordinationRedis() {
	coordinationRedisErrors = NewCounterVec(prometheus.CounterOpts{
		Namespace: "eventnative",
		Subsystem: "coordination",
		Name:      "redis",
	}, coordinationRedisLabels)
}

func CoordinationRedisErrors(errorType string) {
	if Enabled() {
		coordinationRedisErrors.WithLabelValues(errorType).Inc()
	}
}
