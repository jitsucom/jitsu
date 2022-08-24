package metrics

import (
	"github.com/prometheus/client_golang/prometheus"
)

var eventLabels = []string{"project_id", "source_type", "source_tap", "source_id", "destination_type", "destination_id"}
var destinationsLabels = []string{"destination_type"}
var destinationsPerTable = []string{"destination_type", "table_name"}

var (
	successInitDestinations *prometheus.Counter
	errorInitDestination    *prometheus.Counter

	successEvents *prometheus.CounterVec
	skippedEvents *prometheus.CounterVec
	errorsEvents  *prometheus.CounterVec

	successDestinations *prometheus.CounterVec
	errorDestinations   *prometheus.CounterVec

	skippedDestinationEvents *prometheus.CounterVec
	errorDestinationEvents   *prometheus.CounterVec

	successDestinationPerTable *prometheus.CounterVec
	errorDestinationPerTable   *prometheus.CounterVec
)

func initDestinations() {
	successInitDestinations = NewCounter(
		prometheus.CounterOpts{
			Namespace: "eventnative",
			Subsystem: "destinations",
			Name:      "init_success",
		})
	errorInitDestination = NewCounter(
		prometheus.CounterOpts{
			Namespace: "eventnative",
			Subsystem: "destinations",
			Name:      "init_error",
		})
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
	successDestinations = NewCounterVec(prometheus.CounterOpts{
		Namespace: "eventnative",
		Subsystem: "destinations",
		Name:      "events_success",
	}, destinationsLabels)
	errorDestinations = NewCounterVec(prometheus.CounterOpts{
		Namespace: "eventnative",
		Subsystem: "destinations",
		Name:      "events_error",
	}, destinationsLabels)
	skippedDestinationEvents = NewCounterVec(prometheus.CounterOpts{
		Namespace: "eventnative",
		Subsystem: "destinations",
		Name:      "atempts_skipped",
	}, destinationsLabels)
	errorDestinationEvents = NewCounterVec(prometheus.CounterOpts{
		Namespace: "eventnative",
		Subsystem: "destinations",
		Name:      "atempts_error",
	}, destinationsLabels)
	successDestinationPerTable = NewCounterVec(prometheus.CounterOpts{
		Namespace: "eventnative",
		Subsystem: "destinations",
		Name:      "push_events_success",
	}, destinationsPerTable)
	errorDestinationPerTable = NewCounterVec(prometheus.CounterOpts{
		Namespace: "eventnative",
		Subsystem: "destinations",
		Name:      "push_events_error",
	}, destinationsPerTable)
}

func SuccessInitDestination() {
	if Enabled() {
		(*successInitDestinations).Inc()
	}
}

func ErrorInitDestination() {
	if Enabled() {
		(*errorInitDestination).Inc()
	}
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

func SuccessDestinations(destinationType string, value int) {
	if Enabled() {
		successDestinations.WithLabelValues(destinationType).Add(float64(value))
	}
}

func ErrorDestinations(destinationType string, value int) {
	if Enabled() {
		errorDestinations.WithLabelValues(destinationType).Add(float64(value))
	}
}

func ErrorDestinationEvents(storageType string, value int) {
	if Enabled() {
		errorDestinationEvents.WithLabelValues(storageType).Add(float64(value))
	}
}

func SkipDestinationEvents(storageType string, value int) {
	if Enabled() {
		skippedDestinationEvents.WithLabelValues(storageType).Add(float64(value))
	}
}

func ErrorPushDestinationEvents(storageType string, tableName string, value int) {
	if Enabled() {
		errorDestinationPerTable.WithLabelValues(storageType, tableName).Add(float64(value))
	}
}

func SuccessPushDestinationEvents(storageType string, tableName string, value int) {
	if Enabled() {
		successDestinationPerTable.WithLabelValues(storageType, tableName).Add(float64(value))
	}
}
