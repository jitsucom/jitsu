package metrics

import (
	"github.com/prometheus/client_golang/prometheus"
)

var streamEventsQueueLabels = []string{"project_id", "destination_type", "destination_id"}

var (
	streamEventsQueueSize *prometheus.GaugeVec
)

func initStreamEventsQueue() {
	streamEventsQueueSize = NewGaugeVec(prometheus.GaugeOpts{
		Namespace: "eventnative",
		Subsystem: "destinations",
		Name:      "events_queue_size",
	}, streamEventsQueueLabels)
}

func SetStreamEventsQueueSize(destinationType, destinationName string, value int) {
	if Enabled() {
		projectID, destinationID := extractLabels(destinationName)
		streamEventsQueueSize.WithLabelValues(projectID, destinationType, destinationID).Set(float64(value))
	}
}

func DequeuedEvent(destinationType, destinationName string) {
	if Enabled() {
		projectID, destinationID := extractLabels(destinationName)
		streamEventsQueueSize.WithLabelValues(projectID, destinationType, destinationID).Sub(1)
	}
}

func EnqueuedEvent(destinationType, destinationName string) {
	if Enabled() {
		projectID, destinationID := extractLabels(destinationName)
		streamEventsQueueSize.WithLabelValues(projectID, destinationType, destinationID).Add(1)
	}
}
