package events

import (
	"encoding/json"
	"errors"
	"fmt"
	"github.com/jitsucom/jitsu/server/logging"
	"github.com/jitsucom/jitsu/server/metrics"
	"github.com/jitsucom/jitsu/server/parsers"
	"github.com/joncrlsn/dque"
	"time"
)

const eventsPerPersistedFile = 2000

var ErrQueueClosed = errors.New("queue is closed")

type QueuedEvent struct {
	FactBytes    []byte
	DequeuedTime time.Time
	TokenID      string
}

// QueuedFactBuilder creates and returns a new *events.QueuedEvent (must be pointer).
// This is used when we load a segment of the queue from disk.
func QueuedFactBuilder() interface{} {
	return &QueuedEvent{}
}

//PersistentQueue is a persisted queue
type PersistentQueue struct {
	queue      *dque.DQue
	identifier string
}

func NewPersistentQueue(identifier, queueName, logEventPath string) (*PersistentQueue, error) {
	queue, err := dque.NewOrOpen(queueName, logEventPath, eventsPerPersistedFile, QueuedFactBuilder)
	if err != nil {
		return nil, fmt.Errorf("Error opening/creating event queue [%s] in dir [%s]: %v", queueName, logEventPath, err)
	}

	metrics.InitialStreamEventsQueueSize(identifier, queue.Size())

	return &PersistentQueue{queue: queue, identifier: identifier}, nil
}

func (pq *PersistentQueue) Consume(f map[string]interface{}, tokenID string) {
	pq.ConsumeTimed(f, time.Now(), tokenID)
}

func (pq *PersistentQueue) ConsumeTimed(f map[string]interface{}, t time.Time, tokenID string) {
	factBytes, err := json.Marshal(f)
	if err != nil {
		logSkippedEvent(f, fmt.Errorf("Error marshalling events event: %v", err))
		return
	}

	if err := pq.queue.Enqueue(&QueuedEvent{FactBytes: factBytes, DequeuedTime: t, TokenID: tokenID}); err != nil {
		logSkippedEvent(f, fmt.Errorf("Error putting event event bytes to the persistent queue: %v", err))
		return
	}

	metrics.EnqueuedEvent(pq.identifier)
}

func (pq *PersistentQueue) DequeueBlock() (Event, time.Time, string, error) {
	iface, err := pq.queue.DequeueBlock()
	if err != nil {
		if err == dque.ErrQueueClosed {
			err = ErrQueueClosed
		}
		return nil, time.Time{}, "", err
	}

	metrics.DequeuedEvent(pq.identifier)

	wrappedFact, ok := iface.(*QueuedEvent)
	if !ok || len(wrappedFact.FactBytes) == 0 {
		return nil, time.Time{}, "", errors.New("Dequeued object is not a QueuedEvent instance or event bytes is empty")
	}

	fact, err := parsers.ParseJSON(wrappedFact.FactBytes)
	if err != nil {
		return nil, time.Time{}, "", fmt.Errorf("Error unmarshalling events.Event from bytes: %v", err)
	}

	return fact, wrappedFact.DequeuedTime, wrappedFact.TokenID, nil
}

//Close closes underlying queue and returns err if occurred
// *Note: dque.ErrQueueClosed will be ignored
func (pq *PersistentQueue) Close() error {
	err := pq.queue.Close()
	if err == dque.ErrQueueClosed {
		return nil
	}

	return err
}

func logSkippedEvent(event Event, err error) {
	logging.Warnf("Unable to enqueue object %v reason: %v. This object will be skipped", event, err)
}
