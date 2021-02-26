package metrics

import (
	"github.com/prometheus/client_golang/prometheus"
	"github.com/prometheus/client_golang/prometheus/promauto"
)

var streamEventsQueueLabels = []string{"destination_id"}

var (
	streamEventsQueueSize *prometheus.GaugeVec
)

func initStreamEventsQueue() {
	streamEventsQueueSize = promauto.NewGaugeVec(prometheus.GaugeOpts{
		Namespace: "eventnative",
		Subsystem: "destinations",
		Name:      "stream_queue_size",
	}, streamEventsQueueLabels)
}

func InitialStreamEventsQueueSize(destinationId string, value int) {
	if Enabled {
		streamEventsQueueSize.WithLabelValues(destinationId).Set(float64(value))
	}
}

func DequeuedEvent(destinationId string) {
	if Enabled {
		streamEventsQueueSize.WithLabelValues(destinationId).Sub(1)
	}
}

func EnqueuedEvent(destinationId string) {
	if Enabled {
		streamEventsQueueSize.WithLabelValues(destinationId).Add(1)
	}
}
