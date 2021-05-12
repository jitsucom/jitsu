package metrics

import (
	"github.com/prometheus/client_golang/prometheus"
	"github.com/prometheus/client_golang/prometheus/promauto"
)

var eventLabels = []string{"source_id", "project_id", "destination_id"}

var (
	successEvents *prometheus.CounterVec
	skippedEvents *prometheus.CounterVec
	errorsEvents  *prometheus.CounterVec
)

func initEvents() {
	successEvents = promauto.NewCounterVec(prometheus.CounterOpts{
		Namespace: "eventnative",
		Subsystem: "destinations",
		Name:      "events",
	}, eventLabels)
	skippedEvents = promauto.NewCounterVec(prometheus.CounterOpts{
		Namespace: "eventnative",
		Subsystem: "destinations",
		Name:      "skips",
	}, eventLabels)
	errorsEvents = promauto.NewCounterVec(prometheus.CounterOpts{
		Namespace: "eventnative",
		Subsystem: "destinations",
		Name:      "errors",
	}, eventLabels)
}

func SuccessTokenEvent(tokenID, destinationName string) {
	SuccessTokenEvents(tokenID, destinationName, 1)
}

func SuccessTokenEvents(tokenID, destinationName string, value int) {
	if Enabled {
		projectID, destinationID := extractLabels(destinationName)
		successEvents.WithLabelValues("token_"+tokenID, projectID, destinationID).Add(float64(value))
	}
}

func SkipTokenEvent(tokenID, destinationName string) {
	SkipTokenEvents(tokenID, destinationName, 1)
}

func ErrorTokenEvent(tokenID, destinationName string) {
	ErrorTokenEvents(tokenID, destinationName, 1)
}

func ErrorTokenEvents(tokenID, destinationName string, value int) {
	if Enabled {
		projectID, destinationID := extractLabels(destinationName)
		errorsEvents.WithLabelValues("token_"+tokenID, projectID, destinationID).Add(float64(value))
	}
}

func SuccessSourceEvents(sourceName, destinationName string, value int) {
	if Enabled {
		projectID, destinationID := extractLabels(destinationName)
		_, sourceID := extractLabels(sourceName)
		successEvents.WithLabelValues("source_"+sourceID, projectID, destinationID).Add(float64(value))
	}
}

func SkipTokenEvents(tokenID, destinationName string, value int) {
	if Enabled {
		projectID, destinationID := extractLabels(destinationName)
		skippedEvents.WithLabelValues("token_"+tokenID, projectID, destinationID).Add(float64(value))
	}
}

func ErrorSourceEvents(sourceName, destinationName string, value int) {
	if Enabled {
		projectID, destinationID := extractLabels(destinationName)
		_, sourceID := extractLabels(sourceName)
		errorsEvents.WithLabelValues("source_"+sourceID, projectID, destinationID).Add(float64(value))
	}
}
