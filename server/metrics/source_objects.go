package metrics

import (
	"github.com/prometheus/client_golang/prometheus"
)

var objectsLabels = []string{"project_id", "source_type", "source_tap", "source_id"}
var sourcesLabels = []string{"source_type"}

var (
	successObjects *prometheus.CounterVec
	errorsObjects  *prometheus.CounterVec

	successSources *prometheus.CounterVec
	errorSources   *prometheus.CounterVec

	successSynchronization *prometheus.Counter
	errorSynchronization   *prometheus.Counter
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
	successSources = NewCounterVec(prometheus.CounterOpts{
		Namespace: "eventnative",
		Subsystem: "sources_events",
		Name:      "success",
	}, sourcesLabels)
	errorSources = NewCounterVec(prometheus.CounterOpts{
		Namespace: "eventnative",
		Subsystem: "sources_events",
		Name:      "error",
	}, sourcesLabels)
	successSynchronization = NewCounter(prometheus.CounterOpts{
		Namespace: "eventnative",
		Subsystem: "sources_synchronization",
		Name:      "success",
	})
	errorSynchronization = NewCounter(prometheus.CounterOpts{
		Namespace: "eventnative",
		Subsystem: "sources_synchronization",
		Name:      "error",
	})
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

func SuccessSources(sourceType string) {
	if Enabled() {
		successSources.WithLabelValues(sourceType).Inc()
	}
}

func ErrorSources(sourceType string) {
	if Enabled() {
		errorSources.WithLabelValues(sourceType).Inc()
	}
}

func SuccessSynchronization() {
	if Enabled() {
		(*successSynchronization).Inc()
	}
}

func ErrorSynchronization() {
	if Enabled() {
		(*errorSynchronization).Inc()
	}
}
