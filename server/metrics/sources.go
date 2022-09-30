package metrics

import (
	"github.com/prometheus/client_golang/prometheus"
)

var (
	successInitSources *prometheus.Counter
	errorInitSources   *prometheus.Counter
)

func initSources() {
	successInitSources = NewCounter(
		prometheus.CounterOpts{
			Namespace: "eventnative",
			Subsystem: "sources_init",
			Name:      "success",
		})
	errorInitSources = NewCounter(
		prometheus.CounterOpts{
			Namespace: "eventnative",
			Subsystem: "sources_init",
			Name:      "error",
		})
}

func SuccessInitSource() {
	if Enabled() {
		(*successInitSources).Inc()
	}
}

func ErrorInitSource() {
	if Enabled() {
		(*errorInitSources).Inc()
	}
}
