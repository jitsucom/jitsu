package metrics

import (
	"github.com/prometheus/client_golang/prometheus"
)

var (
	successInitDestinations *prometheus.Counter
	errorInitDestination    *prometheus.Counter
)

func initDestinations() {
	successInitDestinations = NewCounter(
		prometheus.CounterOpts{
			Namespace: "eventnative",
			Subsystem: "destinations_init",
			Name:      "success",
		})
	errorInitDestination = NewCounter(
		prometheus.CounterOpts{
			Namespace: "eventnative",
			Subsystem: "destinations_init",
			Name:      "error",
		})
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
