package metrics

import (
	"github.com/prometheus/client_golang/prometheus"
)

var objectsLabels = []string{"project_id", "source_type", "source_tap", "source_id"}

var (
	successObjects *prometheus.CounterVec
	errorsObjects  *prometheus.CounterVec
)

func initSourceObjects() {
	successObjects = NewCounterVec(prometheus.CounterOpts{
		Namespace: "eventnative",
		Subsystem: "sources",
		Name:      "objects",
	}, objectsLabels)
	errorsObjects = NewCounterVec(prometheus.CounterOpts{
		Namespace: "eventnative",
		Subsystem: "sources",
		Name:      "errors",
	}, objectsLabels)
}

func SuccessTokenObjects(tokenID string, value int) {
	SuccessObjects(TokenSourceType, EmptySourceTap, tokenID, value)
}

func SuccessObjects(sourceType, sourceTap, sourceName string, value int) {
	if Enabled() {
		projectID, sourceID := extractLabels(sourceName)
		successObjects.WithLabelValues(projectID, sourceType, sourceTap, sourceID).Add(float64(value))
	}
}

func ErrorTokenObjects(tokenID string, value int) {
	ErrorObjects(TokenSourceType, EmptySourceTap, tokenID, value)
}

func ErrorObjects(sourceType, sourceTap, sourceName string, value int) {
	if Enabled() {
		projectID, sourceID := extractLabels(sourceName)
		errorsObjects.WithLabelValues(projectID, sourceType, sourceTap, sourceID).Add(float64(value))
	}
}
