package metrics

import (
	"github.com/prometheus/client_golang/prometheus"
)

var (
	successTokenUpdating *prometheus.Counter
	errorTokenUpdating   *prometheus.Counter
)

func initAuthorization() {
	successTokenUpdating = NewCounter(
		prometheus.CounterOpts{
			Namespace: "eventnative",
			Subsystem: "authorization",
			Name:      "success",
		})
	errorTokenUpdating = NewCounter(
		prometheus.CounterOpts{
			Namespace: "eventnative",
			Subsystem: "authorization",
			Name:      "error",
		})
}

func SuccessTokenUpdating() {
	if Enabled() {
		(*successTokenUpdating).Inc()
	}
}

func ErrorTokenUpdating() {
	if Enabled() {
		(*errorTokenUpdating).Inc()
	}
}
