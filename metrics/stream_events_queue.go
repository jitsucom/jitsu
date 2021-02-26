package metrics

import (
	"github.com/prometheus/client_golang/prometheus"
	"github.com/prometheus/client_golang/prometheus/promauto"
)

var streamEventsQueueLabels = []string{"project_id", "destination_id"}

var (
	streamEventsQueueSize *prometheus.GaugeVec
)

func initStreamEventsQueue() {
	streamEventsQueueSize = promauto.NewGaugeVec(prometheus.GaugeOpts{
		Namespace: "eventnative",
		Subsystem: "destinations",
		Name:      "events_queue_size",
	}, streamEventsQueueLabels)
}

func InitialStreamEventsQueueSize(destinationName string, value int) {
	if Enabled {
		projectId, destinationId := extractLabels(destinationName)
		streamEventsQueueSize.WithLabelValues(projectId, destinationId).Set(float64(value))
	}
}

func DequeuedEvent(destinationName string) {
	if Enabled {
		projectId, destinationId := extractLabels(destinationName)
		streamEventsQueueSize.WithLabelValues(projectId, destinationId).Sub(1)
	}
}

func EnqueuedEvent(destinationName string) {
	if Enabled {
		projectId, destinationId := extractLabels(destinationName)
		streamEventsQueueSize.WithLabelValues(projectId, destinationId).Add(1)
	}
}
