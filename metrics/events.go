package metrics

import (
	"github.com/prometheus/client_golang/prometheus"
	"github.com/prometheus/client_golang/prometheus/promauto"
)

var eventLabels = []string{"api_key_id", "project_id", "destination_id"}

var (
	successEvents *prometheus.CounterVec
	errorsEvents  *prometheus.CounterVec
)

func initEvents() {
	successEvents = promauto.NewCounterVec(prometheus.CounterOpts{
		Namespace: "eventnative",
		Subsystem: "destinations",
		Name:      "events",
	}, eventLabels)
	errorsEvents = promauto.NewCounterVec(prometheus.CounterOpts{
		Namespace: "eventnative",
		Subsystem: "destinations",
		Name:      "errors",
	}, eventLabels)
}

func SuccessEvent(tokenId, destinationName string) {
	SuccessEvents(tokenId, destinationName, 1)
}

func SuccessEvents(tokenId, destinationName string, value int) {
	if Enabled {
		projectId, destinationId := extractLabels(destinationName)
		successEvents.WithLabelValues(tokenId, projectId, destinationId).Add(float64(value))
	}
}

func ErrorEvent(tokenId, destinationName string) {
	ErrorEvents(tokenId, destinationName, 1)
}

func ErrorEvents(tokenId, destinationName string, value int) {
	if Enabled {
		projectId, destinationId := extractLabels(destinationName)
		errorsEvents.WithLabelValues(tokenId, projectId, destinationId).Add(float64(value))
	}
}
