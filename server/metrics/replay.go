package metrics

import (
	"github.com/prometheus/client_golang/prometheus"
)

var (
	fileSendingCount   *prometheus.Counter
	successFileSending *prometheus.Counter
	errorFileSending   *prometheus.Counter
)

func initFileSending() {
	fileSendingCount = NewCounter(
		prometheus.CounterOpts{
			Namespace: "eventnative",
			Subsystem: "replay",
			Name:      "count",
			Help:      "Shows how many files are prepared to send",
		})

	successFileSending = NewCounter(
		prometheus.CounterOpts{
			Namespace: "eventnative",
			Subsystem: "replay",
			Name:      "success",
			Help:      "Shows how many files were sent successfully",
		})

	errorFileSending = NewCounter(
		prometheus.CounterOpts{
			Namespace: "eventnative",
			Subsystem: "replay",
			Name:      "error",
			Help:      "Shows how many files were sent with errors",
		})
}

func SetFileCount(value int64) {
	if Enabled() {
		(*fileSendingCount).Add(float64(value))
	}
}

func SuccessFileSending() {
	if Enabled() {
		(*successFileSending).Inc()
	}
}

func ErrorFileSending() {
	if Enabled() {
		(*errorFileSending).Inc()
	}
}
