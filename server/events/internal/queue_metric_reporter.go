package internal

import (
	"github.com/jitsucom/jitsu/server/metrics"
)

type MetricReporter interface {
	SetMetrics(subsystem, identifier string, size int, bufferSize int)
	EnqueuedEvent(subsystem, identifier string)
	DequeuedEvent(subsystem, identifier string)
}

//SharedQueueMetricReporter is used for shared queues e.g. Redis (1 queue for all servers)
type SharedQueueMetricReporter struct{}

func (sqmr *SharedQueueMetricReporter) SetMetrics(subsystem, identifier string, size int, bufferSize int) {
	metrics.SetStreamEventsQueueSize(subsystem, identifier, size)
	metrics.SetStreamEventsBufferSize(subsystem, identifier, bufferSize)
}

func (sqmr *SharedQueueMetricReporter) EnqueuedEvent(subsystem, identifier string) {
	//do nothing
}

func (sqmr *SharedQueueMetricReporter) DequeuedEvent(subsystem, identifier string) {
	//do nothing
}

//ServerMetricReporter is used for inmemory queues (queue per server)
type ServerMetricReporter struct{}

func (smr *ServerMetricReporter) SetMetrics(subsystem, identifier string, size int, bufferSize int) {
	metrics.SetStreamEventsQueueSize(subsystem, identifier, size)
	metrics.SetStreamEventsBufferSize(subsystem, identifier, bufferSize)
}

func (smr *ServerMetricReporter) EnqueuedEvent(subsystem, identifier string) {
	metrics.EnqueuedEvent(subsystem, identifier)
}

func (smr *ServerMetricReporter) DequeuedEvent(subsystem, identifier string) {
	metrics.DequeuedEvent(subsystem, identifier)
}
