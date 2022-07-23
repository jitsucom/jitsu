package metrics

import (
	"github.com/prometheus/client_golang/prometheus"
)

var (
	successDestinations *prometheus.Counter
	errorDestination    *prometheus.Counter
)

func initDestinations() {
	successDestinations = NewCounter(
		prometheus.CounterOpts{
			Namespace: "eventnative",
			Subsystem: "destinations",
			Name:      "success",
		})
	errorDestination = NewCounter(
		prometheus.CounterOpts{
			Namespace: "eventnative",
			Subsystem: "destinations",
			Name:      "error",
		})
}

func SuccessDestination() {
	if Enabled() {
		(*successDestinations).Inc()
	}
}

func ErrorDestination() {
	if Enabled() {
		(*errorDestination).Inc()
	}
}
