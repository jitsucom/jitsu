package events

import (
	"encoding/json"
	"errors"
	"fmt"
	"github.com/jitsucom/eventnative/logging"
	"github.com/jitsucom/eventnative/metrics"
	"github.com/jitsucom/eventnative/parsers"
	"github.com/joncrlsn/dque"
	"time"
)

const eventsPerPersistedFile = 2000

var ErrQueueClosed = errors.New("queue is closed")

type QueuedEvent struct {
	FactBytes    []byte
	DequeuedTime time.Time
	TokenId      string
}

// QueuedFactBuilder creates and returns a new *events.QueuedEvent (must be pointer).
// This is used when we load a segment of the queue from disk.
func QueuedFactBuilder() interface{} {
	return &QueuedEvent{}
}

type PersistentQueue struct {
	queue      *dque.DQue
	identifier string
}

func NewPersistentQueue(identifier, queueName, fallbackDir string) (*PersistentQueue, error) {
	queue, err := dque.NewOrOpen(queueName, fallbackDir, eventsPerPersistedFile, QueuedFactBuilder)
	if err != nil {
		return nil, fmt.Errorf("Error opening/creating event queue [%s] in dir [%s]: %v", queueName, fallbackDir, err)
	}

	metrics.InitialStreamEventsQueueSize(identifier, queue.Size())

	return &PersistentQueue{queue: queue, identifier: identifier}, nil
}

func (pq *PersistentQueue) Consume(f map[string]interface{}, tokenId string) {
	pq.ConsumeTimed(f, time.Now(), tokenId)
}

func (pq *PersistentQueue) ConsumeTimed(f map[string]interface{}, t time.Time, tokenId string) {
	factBytes, err := json.Marshal(f)
	if err != nil {
		logSkippedEvent(f, fmt.Errorf("Error marshalling events event: %v", err))
		return
	}

	if err := pq.queue.Enqueue(&QueuedEvent{FactBytes: factBytes, DequeuedTime: t, TokenId: tokenId}); err != nil {
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

	fact, err := parsers.ParseJson(wrappedFact.FactBytes)
	if err != nil {
		return nil, time.Time{}, "", fmt.Errorf("Error unmarshalling events.Event from bytes: %v", err)
	}

	return fact, wrappedFact.DequeuedTime, wrappedFact.TokenId, nil
}

func (pq *PersistentQueue) Close() error {
	return pq.queue.Close()
}

func logSkippedEvent(event Event, err error) {
	logging.Warnf("Unable to enqueue object %v reason: %v. This object will be skipped", event, err)
}
