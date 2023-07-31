package metrics

import (
	"github.com/prometheus/client_golang/prometheus"
)

var usersRecognitionLabels = []string{"project_id", "token_id"}

type RecognitionMetric int

const (
	TotalEvents RecognitionMetric = iota
	AnonymousEvents
	IdentifiedEvents
	IdentifiedCacheHits
	IdentifiedAggregatedEvents
	RecognizedEvents
	BotEvents
	_
	Dummy //to allocate proper array
)

var (
	recognitionQueueSize = map[string]*prometheus.GaugeVec{}
	recognitionEvents    []*prometheus.CounterVec
)

func initUsersRecognitionQueue() {
	recognitionQueueSize["users_recognition"] = NewGaugeVec(prometheus.GaugeOpts{
		Namespace: "eventnative",
		Subsystem: "users_recognition",
		Name:      "queue_size",
	}, []string{})
	recognitionQueueSize["users_identified"] = NewGaugeVec(prometheus.GaugeOpts{
		Namespace: "eventnative",
		Subsystem: "users_identified",
		Name:      "queue_size",
	}, []string{})
	recognitionQueueSize["users_aggregated"] = NewGaugeVec(prometheus.GaugeOpts{
		Namespace: "eventnative",
		Subsystem: "users_aggregated",
		Name:      "queue_size",
	}, []string{})
	recognitionEvents = make([]*prometheus.CounterVec, Dummy)
	eventsNameMap := map[RecognitionMetric]string{
		TotalEvents:                "total_events",
		AnonymousEvents:            "anonymous_events",
		IdentifiedEvents:           "identified_events",
		IdentifiedCacheHits:        "identified_cache_hits",
		IdentifiedAggregatedEvents: "identified_aggregated",
		RecognizedEvents:           "recognized_events",
		BotEvents:                  "bot_events",
	}
	for id, name := range eventsNameMap {
		recognitionEvents[id] = NewCounterVec(prometheus.CounterOpts{
			Namespace: "eventnative",
			Subsystem: "users_recognition",
			Name:      name,
		}, usersRecognitionLabels)
	}
}

func InitialUsersRecognitionQueueSize(identifier string, value int) {
	if Enabled() {
		gaugeVec, ok := recognitionQueueSize[identifier]
		if ok {
			gaugeVec.WithLabelValues().Set(float64(value))
		}
	}
}

func DequeuedRecognitionEvent(identifier string) {
	if Enabled() {
		gaugeVec, ok := recognitionQueueSize[identifier]
		if ok {
			gaugeVec.WithLabelValues().Sub(1)
		}
	}
}

func EnqueuedRecognitionEvent(identifier string) {
	if Enabled() {
		gaugeVec, ok := recognitionQueueSize[identifier]
		if ok {
			gaugeVec.WithLabelValues().Add(1)
		}
	}
}

func RecognitionEvent(metricType RecognitionMetric, tokenID string, value int) {
	if Enabled() {
		projectID, tokenID := extractLabels(tokenID)
		recognitionEvents[metricType].WithLabelValues(projectID, tokenID).Add(float64(value))
	}
}
