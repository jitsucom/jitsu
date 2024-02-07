package events

import (
	"errors"
	"fmt"
	"time"

	"github.com/jitsucom/jitsu/server/events/internal"
	"github.com/jitsucom/jitsu/server/logging"
	"github.com/jitsucom/jitsu/server/queue"
	"github.com/jitsucom/jitsu/server/safego"
	"github.com/jitsucom/jitsu/server/timestamp"
)

var ErrQueueClosed = errors.New("queue is closed")

// TimedEventBuilder creates and returns a new *events.TimedEvent (must be pointer).
// This is used on deserialization
func TimedEventBuilder() interface{} {
	return &TimedEvent{}
}

// NativeQueue is a event queue implementation by Jitsu
type NativeQueue struct {
	namespace  string
	subsystem  string
	identifier string
	queue      queue.Queue

	metricsReporter internal.MetricReporter
	retriesBuffer   chan *TimedEvent
	closed          chan struct{}
}

func NewNativeQueue(namespace, subsystem, identifier string, underlyingQueue queue.Queue) (Queue, error) {
	var metricsReporter internal.MetricReporter
	if underlyingQueue.Type() == queue.RedisType {
		metricsReporter = &internal.SharedQueueMetricReporter{}
	} else {
		metricsReporter = &internal.ServerMetricReporter{}
	}

	metricsReporter.SetMetrics(subsystem, identifier, int(underlyingQueue.Size()), int(underlyingQueue.BufferSize()))

	nq := &NativeQueue{
		queue:           underlyingQueue,
		namespace:       namespace,
		subsystem:       subsystem,
		identifier:      identifier,
		metricsReporter: metricsReporter,
		retriesBuffer:   make(chan *TimedEvent, 10000),
		closed:          make(chan struct{}, 1),
	}

	safego.Run(nq.startAsync)
	return nq, nil
}

func (q *NativeQueue) startAsync() {
	debugTicker := time.NewTicker(time.Minute * 10)
	metricsTicker := time.NewTicker(time.Second * 60)
	bufferTicker := time.NewTicker(time.Minute * 1)
	for {
		select {
		case <-q.closed:
			return
		case <-metricsTicker.C:
			q.metricsReporter.SetMetrics(q.subsystem, q.identifier, int(q.queue.Size()), int(q.queue.BufferSize()))
		case <-debugTicker.C:
			size := q.queue.Size()
			logging.Infof("[queue: %s_%s_%s] current size: %d", q.namespace, q.subsystem, q.identifier, size)
		case <-bufferTicker.C:
			count := 0
		loop:
			for {
				select {
				case te := <-q.retriesBuffer:
					if te == nil {
						break loop
					}
					if err := q.queue.Push(te); err != nil {
						logSkippedEvent(te.Payload, fmt.Errorf("Error pushing event to the queue: %v", err))
					}
					count++
					q.metricsReporter.EnqueuedEvent(q.subsystem, q.identifier)
				default:
					break loop
				}
			}
			if count > 0 {
				logging.Infof("[queue: %s_%s_%s] pushed %d events from retries buffer", q.namespace, q.subsystem, q.identifier, count)
			}
		}
	}
}

func (q *NativeQueue) Consume(f map[string]interface{}, tokenID string) {
	q.ConsumeTimed(f, timestamp.Now().UTC(), tokenID, 0)
}

func (q *NativeQueue) ConsumeTimed(payload map[string]interface{}, t time.Time, tokenID string, retriesCount int) {
	te := &TimedEvent{
		Payload:      payload,
		DequeuedTime: t,
		TokenID:      tokenID,
		RetriesCount: retriesCount,
	}
	if retriesCount > 0 {
		select {
		case <-q.closed:
			return
		case q.retriesBuffer <- te:
			return
		default:
			//buffer is full. insert right away
		}
	}
	if err := q.queue.Push(te); err != nil {
		logSkippedEvent(payload, fmt.Errorf("Error pushing event to the queue: %v", err))
		return
	}
	q.metricsReporter.EnqueuedEvent(q.subsystem, q.identifier)
}

func (q *NativeQueue) DequeueBlock() (Event, time.Time, string, int, error) {
	ite, err := q.queue.Pop()
	if err != nil {
		if err == queue.ErrQueueClosed {
			return nil, time.Time{}, "", 0, ErrQueueClosed
		}

		return nil, time.Time{}, "", 0, err
	}

	q.metricsReporter.DequeuedEvent(q.subsystem, q.identifier)

	te, ok := ite.(*TimedEvent)
	if !ok {
		return nil, time.Time{}, "", 0, fmt.Errorf("wrong type of event dto in queue. Expected: *TimedEvent, actual: %T (%s)", ite, ite)
	}

	return te.Payload, te.DequeuedTime, te.TokenID, te.RetriesCount, nil
}

// Close closes underlying queue
func (q *NativeQueue) Close() error {
	select {
	case <-q.closed:
		return nil
	default:
		close(q.closed)
		close(q.retriesBuffer)
		return q.queue.Close()
	}
}
