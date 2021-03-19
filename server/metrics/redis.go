package metrics

import (
	"github.com/prometheus/client_golang/prometheus"
	"github.com/prometheus/client_golang/prometheus/promauto"
)

var metaRedisLabels = []string{"error_type"}

var (
	redisErrors *prometheus.CounterVec
)

func initRedis() {
	redisErrors = promauto.NewCounterVec(prometheus.CounterOpts{
		Namespace: "eventnative",
		Subsystem: "meta",
		Name:      "redis",
	}, metaRedisLabels)
}

func RedisErrors(errorType string) {
	if Enabled {
		redisErrors.WithLabelValues(errorType).Inc()
	}
}
