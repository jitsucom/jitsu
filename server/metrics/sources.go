package metrics

import (
	"github.com/prometheus/client_golang/prometheus"
)

var (
	successSources *prometheus.Counter
	errorSources   *prometheus.Counter
)

func initSources() {
	successSources = NewCounter(
		prometheus.CounterOpts{
			Namespace: "eventnative",
			Subsystem: "sources",
			Name:      "success",
		})
	errorSources = NewCounter(
		prometheus.CounterOpts{
			Namespace: "eventnative",
			Subsystem: "sources",
			Name:      "error",
		})
}

func SuccessSource() {
	if Enabled() {
		(*successSources).Inc()
	}
}

func ErrorSource() {
	if Enabled() {
		(*errorSources).Inc()
	}
}
