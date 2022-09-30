package metrics

import (
	"github.com/prometheus/client_golang/prometheus"
)

var (
	successSlackNotification *prometheus.Counter
	errorSlackNotification   *prometheus.Counter
)

func initNotifications() {
	successSlackNotification = NewCounter(
		prometheus.CounterOpts{
			Namespace: "eventnative",
			Subsystem: "slacknotification",
			Name:      "success",
		})
	errorSlackNotification = NewCounter(
		prometheus.CounterOpts{
			Namespace: "eventnative",
			Subsystem: "slacknotification",
			Name:      "error",
		})
}

func SuccessSlackNotification() {
	if Enabled() {
		(*successSlackNotification).Inc()
	}
}

func ErrorSlackNotification() {
	if Enabled() {
		(*errorSlackNotification).Inc()
	}
}
