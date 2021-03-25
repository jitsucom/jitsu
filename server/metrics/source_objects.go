package metrics

import (
	"github.com/prometheus/client_golang/prometheus"
	"github.com/prometheus/client_golang/prometheus/promauto"
)

var objectsLabels = []string{"project_id", "source_id"}

var (
	successObjects *prometheus.CounterVec
	errorsObjects  *prometheus.CounterVec
)

func initSourceObjects() {
	successObjects = promauto.NewCounterVec(prometheus.CounterOpts{
		Namespace: "eventnative",
		Subsystem: "sources",
		Name:      "objects",
	}, objectsLabels)
	errorsObjects = promauto.NewCounterVec(prometheus.CounterOpts{
		Namespace: "eventnative",
		Subsystem: "sources",
		Name:      "errors",
	}, objectsLabels)
}

func SuccessObject(sourceName string) {
	SuccessObjects(sourceName, 1)
}

func SuccessObjects(sourceName string, value int) {
	if Enabled {
		projectID, sourceID := extractLabels(sourceName)
		successObjects.WithLabelValues(projectID, sourceID).Add(float64(value))
	}
}

func ErrorObject(sourceName string) {
	ErrorObjects(sourceName, 1)
}

func ErrorObjects(sourceName string, value int) {
	if Enabled {
		projectID, sourceID := extractLabels(sourceName)
		errorsObjects.WithLabelValues(projectID, sourceID).Add(float64(value))
	}
}
