package metrics

import (
	"github.com/prometheus/client_golang/prometheus"
)

var (
	usersRecognitionQueueSize = map[string]*prometheus.GaugeVec{}
)

func initUsersRecognitionQueue() {
	usersRecognitionQueueSize["users_recognition"] = NewGaugeVec(prometheus.GaugeOpts{
		Namespace: "eventnative",
		Subsystem: "users_recognition",
		Name:      "queue_size",
	}, []string{})
	usersRecognitionQueueSize["users_identified"] = NewGaugeVec(prometheus.GaugeOpts{
		Namespace: "eventnative",
		Subsystem: "users_identified",
		Name:      "queue_size",
	}, []string{})
}

func InitialUsersRecognitionQueueSize(identifier string, value int) {
	if Enabled() {
		gaugeVec, ok := usersRecognitionQueueSize[identifier]
		if ok {
			gaugeVec.WithLabelValues().Set(float64(value))
		}
	}
}

func DequeuedRecognitionEvent(identifier string) {
	if Enabled() {
		gaugeVec, ok := usersRecognitionQueueSize[identifier]
		if ok {
			gaugeVec.WithLabelValues().Sub(1)
		}
	}
}

func EnqueuedRecognitionEvent(identifier string) {
	if Enabled() {
		gaugeVec, ok := usersRecognitionQueueSize[identifier]
		if ok {
			gaugeVec.WithLabelValues().Add(1)
		}
	}
}
