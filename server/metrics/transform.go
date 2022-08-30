package metrics

import (
	"github.com/prometheus/client_golang/prometheus"
	"strings"
)

var transformLabels = []string{"project_id", "destination_id"}

var (
	transformKeyValueGets *prometheus.CounterVec
	transformKeyValueDels *prometheus.CounterVec
	transformKeyValueSets *prometheus.HistogramVec

	transformErrors *prometheus.CounterVec

	transformKeyValueErrors *prometheus.CounterVec
)

func initTransform() {
	transformKeyValueGets = NewCounterVec(prometheus.CounterOpts{
		Namespace: "eventnative",
		Subsystem: "javascript",
		Name:      "kv_get",
	}, transformLabels)

	transformKeyValueDels = NewCounterVec(prometheus.CounterOpts{
		Namespace: "eventnative",
		Subsystem: "javascript",
		Name:      "kv_del",
	}, transformLabels)
	transformKeyValueSets = NewHistogramVec(prometheus.HistogramOpts{
		Namespace: "eventnative",
		Subsystem: "javascript",
		Name:      "kv_set",
		Buckets:   []float64{40, 1000},
	}, transformLabels)

	transformErrors = NewCounterVec(prometheus.CounterOpts{
		Namespace: "eventnative",
		Subsystem: "javascript",
		Name:      "errors",
	}, transformLabels)

	transformKeyValueErrors = NewCounterVec(prometheus.CounterOpts{
		Namespace: "eventnative",
		Subsystem: "javascript",
		Name:      "redis",
	}, []string{"error_type"})

}

func TransformErrors(destinationId string) {
	if Enabled() {
		transformErrors.WithLabelValues(strings.Split(destinationId, ".")...).Inc()
	}
}
func TransformKeyValueGet(destinationId string) {
	if Enabled() {
		transformKeyValueGets.WithLabelValues(strings.Split(destinationId, ".")...).Inc()
	}
}

func TransformKeyValueDel(destinationId string) {
	if Enabled() {
		transformKeyValueDels.WithLabelValues(strings.Split(destinationId, ".")...).Inc()
	}
}

func TransformKeyValueSet(destinationId string, size int) {
	if Enabled() {
		transformKeyValueSets.WithLabelValues(strings.Split(destinationId, ".")...).Observe(float64(size))
	}
}

func TransformKeyValueRedisErrors(errorType string) {
	if Enabled() {
		transformKeyValueErrors.WithLabelValues(errorType).Inc()
	}
}
