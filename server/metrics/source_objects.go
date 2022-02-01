package metrics

import (
	"github.com/prometheus/client_golang/prometheus"
)

var objectsLabels = []string{"project_id", "source_type", "source_id"}

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

func SuccessObject(sourceType, sourceName string) {
	SuccessObjects(sourceType, sourceName, 1)
}

func SuccessObjects(sourceType, sourceName string, value int) {
	if Enabled() {
		projectID, sourceID := extractLabels(sourceName)
		successObjects.WithLabelValues(projectID, sourceType, sourceID).Add(float64(value))
	}
}

func ErrorObject(sourceType, sourceName string) {
	ErrorObjects(sourceType, sourceName, 1)
}

func ErrorObjects(sourceType, sourceName string, value int) {
	if Enabled() {
		projectID, sourceID := extractLabels(sourceName)
		errorsObjects.WithLabelValues(projectID, sourceType, sourceID).Add(float64(value))
	}
}
