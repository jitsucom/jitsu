package metrics

import (
	"github.com/prometheus/client_golang/prometheus"
)

var (
	successEmail *prometheus.Counter
	errorEmail   *prometheus.Counter
)

func initEmails() {
	successEmail = NewCounter(
		prometheus.CounterOpts{
			Namespace: "eventnative",
			Subsystem: "email",
			Name:      "success",
		})
	errorEmail = NewCounter(
		prometheus.CounterOpts{
			Namespace: "eventnative",
			Subsystem: "email",
			Name:      "error",
		})
}

func SuccessEmail() {
	if Enabled() {
		(*successEmail).Inc()
	}
}

func ErrorEmail() {
	if Enabled() {
		(*errorEmail).Inc()
	}
}
