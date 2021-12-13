package internal

import (
	"github.com/jitsucom/jitsu/server/metrics"
)

type MetricReporter interface {
	SetMetrics(identifier string, size int)
	EnqueuedEvent(identifier string)
	DequeuedEvent(identifier string)
}

//SharedQueueMetricReporter is used for shared queues e.g. Redis (1 queue for all servers)
type SharedQueueMetricReporter struct{}

func (sqmr *SharedQueueMetricReporter) SetMetrics(identifier string, size int) {
	metrics.SetStreamEventsQueueSize(identifier, size)
}

func (sqmr *SharedQueueMetricReporter) EnqueuedEvent(identifier string) {
	//do nothing
}

func (sqmr *SharedQueueMetricReporter) DequeuedEvent(identifier string) {
	//do nothing
}

//ServerMetricReporter is used for inmemory queues (queue per server)
type ServerMetricReporter struct{}

func (smr *ServerMetricReporter) SetMetrics(identifier string, size int) {
	metrics.SetStreamEventsQueueSize(identifier, size)
}

func (smr *ServerMetricReporter) EnqueuedEvent(identifier string) {
	metrics.EnqueuedEvent(identifier)
}

func (smr *ServerMetricReporter) DequeuedEvent(identifier string) {
	metrics.DequeuedEvent(identifier)
}
