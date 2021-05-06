package metrics

import (
	"github.com/prometheus/client_golang/prometheus"
	"github.com/prometheus/client_golang/prometheus/promauto"
)

var coordinationRedisLabels = []string{"error_type"}

var (
	coordinationRedisErrors *prometheus.CounterVec
)

func initCoordinationRedis() {
	coordinationRedisErrors = promauto.NewCounterVec(prometheus.CounterOpts{
		Namespace: "eventnative",
		Subsystem: "coordination",
		Name:      "redis",
	}, coordinationRedisLabels)
}

func CoordinationRedisErrors(errorType string) {
	if Enabled {
		coordinationRedisErrors.WithLabelValues(errorType).Inc()
	}
}
