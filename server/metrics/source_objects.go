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
		projectId, sourceId := extractLabels(sourceName)
		successObjects.WithLabelValues(projectId, sourceId).Add(float64(value))
	}
}

func ErrorObject(sourceName string) {
	ErrorObjects(sourceName, 1)
}

func ErrorObjects(sourceName string, value int) {
	if Enabled {
		projectId, sourceId := extractLabels(sourceName)
		errorsObjects.WithLabelValues(projectId, sourceId).Add(float64(value))
	}
}
