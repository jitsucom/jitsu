package metrics

import (
	"github.com/prometheus/client_golang/prometheus"
)

var sourcesPoolLabels = []string{"type"}

var (
	sourcesGoroutinesPoolSize *prometheus.GaugeVec
	sourcesHeartBeatsPoolSize *prometheus.Gauge
)

func initSourcesPool() {
	sourcesGoroutinesPoolSize = NewGaugeVec(prometheus.GaugeOpts{
		Namespace: "eventnative",
		Subsystem: "sources",
		Name:      "goroutines_pool",
	}, sourcesPoolLabels)

	sourcesHeartBeatsPoolSize = NewGauge(prometheus.GaugeOpts{
		Namespace: "eventnative",
		Subsystem: "sources",
		Name:      "heartbeats_pool",
	})
}

func FreeSourcesGoroutines(value int) {
	if Enabled() {
		sourcesGoroutinesPoolSize.WithLabelValues("free").Set(float64(value))
	}
}

func RunningSourcesGoroutines(value int) {
	if Enabled() {
		sourcesGoroutinesPoolSize.WithLabelValues("running").Set(float64(value))
	}
}

func HeartBeatPoolSize(value int) {
	if Enabled() {
		(*sourcesHeartBeatsPoolSize).Set(float64(value))
	}
}
