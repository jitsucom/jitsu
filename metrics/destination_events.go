package metrics

import (
	"github.com/prometheus/client_golang/prometheus"
	"github.com/prometheus/client_golang/prometheus/promauto"
)

var eventLabels = []string{"source_id", "project_id", "destination_id"}

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

func SuccessTokenEvent(tokenId, destinationName string) {
	SuccessTokenEvents(tokenId, destinationName, 1)
}

func SuccessTokenEvents(tokenId, destinationName string, value int) {
	if Enabled {
		projectId, destinationId := extractLabels(destinationName)
		successEvents.WithLabelValues("token_"+tokenId, projectId, destinationId).Add(float64(value))
	}
}

func ErrorTokenEvent(tokenId, destinationName string) {
	ErrorTokenEvents(tokenId, destinationName, 1)
}

func ErrorTokenEvents(tokenId, destinationName string, value int) {
	if Enabled {
		projectId, destinationId := extractLabels(destinationName)
		errorsEvents.WithLabelValues("token_"+tokenId, projectId, destinationId).Add(float64(value))
	}
}

func SuccessSourceEvents(sourceName, destinationName string, value int) {
	if Enabled {
		projectId, destinationId := extractLabels(destinationName)
		_, sourceId := extractLabels(sourceName)
		successEvents.WithLabelValues("source_"+sourceId, projectId, destinationId).Add(float64(value))
	}
}

func ErrorSourceEvents(sourceName, destinationName string, value int) {
	if Enabled {
		projectId, destinationId := extractLabels(destinationName)
		_, sourceId := extractLabels(sourceName)
		errorsEvents.WithLabelValues("source_"+sourceId, projectId, destinationId).Add(float64(value))
	}
}
