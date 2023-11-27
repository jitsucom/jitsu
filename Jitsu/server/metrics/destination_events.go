package metrics

import (
	"github.com/prometheus/client_golang/prometheus"
)

var eventLabels = []string{"project_id", "source_type", "source_tap", "source_id", "destination_type", "destination_id"}

var (
	successEvents *prometheus.CounterVec
	skippedEvents *prometheus.CounterVec
	errorsEvents  *prometheus.CounterVec
)

func initEvents() {
	successEvents = NewCounterVec(prometheus.CounterOpts{
		Namespace: "eventnative",
		Subsystem: "destinations",
		Name:      "events",
	}, eventLabels)
	skippedEvents = NewCounterVec(prometheus.CounterOpts{
		Namespace: "eventnative",
		Subsystem: "destinations",
		Name:      "skips",
	}, eventLabels)
	errorsEvents = NewCounterVec(prometheus.CounterOpts{
		Namespace: "eventnative",
		Subsystem: "destinations",
		Name:      "errors",
	}, eventLabels)
}

func SuccessTokenEvent(tokenID, destinationType, destinationName string) {
	SuccessTokenEvents(tokenID, destinationType, destinationName, 1)
}

func SuccessTokenEvents(tokenID, destinationType, destinationName string, value int) {
	if Enabled() {
		projectID, destinationID := extractLabels(destinationName)
		successEvents.WithLabelValues(projectID, TokenSourceType, EmptySourceTap, tokenID, destinationType, destinationID).Add(float64(value))
	}
}

func SkipTokenEvent(tokenID, destinationType, destinationName string) {
	SkipTokenEvents(tokenID, destinationType, destinationName, 1)
}

func ErrorTokenEvent(tokenID, destinationType, destinationName string) {
	ErrorTokenEvents(tokenID, destinationType, destinationName, 1)
}

func ErrorTokenEvents(tokenID, destinationType, destinationName string, value int) {
	if Enabled() {
		projectID, destinationID := extractLabels(destinationName)
		errorsEvents.WithLabelValues(projectID, TokenSourceType, EmptySourceTap, tokenID, destinationType, destinationID).Add(float64(value))
	}
}

func SuccessSourceEvents(sourceType, sourceTap, sourceName, destinationType, destinationName string, value int) {
	if Enabled() {
		projectID, destinationID := extractLabels(destinationName)
		_, sourceID := extractLabels(sourceName)
		successEvents.WithLabelValues(projectID, sourceType, sourceTap, sourceID, destinationType, destinationID).Add(float64(value))
	}
}

func SkipTokenEvents(tokenID, destinationType, destinationName string, value int) {
	if Enabled() {
		projectID, destinationID := extractLabels(destinationName)
		skippedEvents.WithLabelValues(projectID, TokenSourceType, EmptySourceTap, tokenID, destinationType, destinationID).Add(float64(value))
	}
}

func ErrorSourceEvents(sourceType, sourceTap, sourceName, destinationType, destinationName string, value int) {
	if Enabled() {
		projectID, destinationID := extractLabels(destinationName)
		_, sourceID := extractLabels(sourceName)
		errorsEvents.WithLabelValues(projectID, sourceType, sourceTap, sourceID, destinationType, destinationID).Add(float64(value))
	}
}
