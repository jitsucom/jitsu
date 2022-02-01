package metrics

import (
	"github.com/prometheus/client_golang/prometheus"
)

var (
	usersRecognitionQueueSize *prometheus.GaugeVec
)

func initUsersRecognitionQueue() {
	usersRecognitionQueueSize = NewGaugeVec(prometheus.GaugeOpts{
		Namespace: "eventnative",
		Subsystem: "users_recognition",
		Name:      "queue_size",
	}, []string{})
}

func InitialUsersRecognitionQueueSize(value int) {
	if Enabled() {
		usersRecognitionQueueSize.WithLabelValues().Set(float64(value))
	}
}

func DequeuedRecognitionEvent() {
	if Enabled() {
		usersRecognitionQueueSize.WithLabelValues().Sub(1)
	}
}

func EnqueuedRecognitionEvent() {
	if Enabled() {
		usersRecognitionQueueSize.WithLabelValues().Add(1)
	}
}
