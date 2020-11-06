package events

import (
	"encoding/json"
	"errors"
	"fmt"
	"github.com/joncrlsn/dque"
	"github.com/ksensehq/eventnative/logging"
	"github.com/ksensehq/eventnative/parsers"
	"time"
)

const eventsPerPersistedFile = 2000

var ErrQueueClosed = errors.New("queue is closed")

type QueuedFact struct {
	FactBytes    []byte
	DequeuedTime time.Time
	TokenId      string
}

// QueuedFactBuilder creates and returns a new *events.QueuedFact (must be pointer).
// This is used when we load a segment of the queue from disk.
func QueuedFactBuilder() interface{} {
	return &QueuedFact{}
}

type PersistentQueue struct {
	queue *dque.DQue
}

func NewPersistentQueue(queueName, fallbackDir string) (*PersistentQueue, error) {
	queue, err := dque.NewOrOpen(queueName, fallbackDir, eventsPerPersistedFile, QueuedFactBuilder)
	if err != nil {
		return nil, fmt.Errorf("Error opening/creating event queue [%s]: %v", queueName, err)
	}

	return &PersistentQueue{queue: queue}, nil
}

func (pq *PersistentQueue) Consume(f Fact, tokenId string) {
	pq.ConsumeTimed(f, time.Now(), tokenId)
}

func (pq *PersistentQueue) ConsumeTimed(f Fact, t time.Time, tokenId string) {
	factBytes, err := json.Marshal(f)
	if err != nil {
		logSkippedEvent(f, fmt.Errorf("Error marshalling events fact: %v", err))
		return
	}

	if err := pq.queue.Enqueue(&QueuedFact{FactBytes: factBytes, DequeuedTime: t, TokenId: tokenId}); err != nil {
		logSkippedEvent(f, fmt.Errorf("Error putting event fact bytes to the persistent queue: %v", err))
		return
	}
}

func (pq *PersistentQueue) DequeueBlock() (Fact, time.Time, string, error) {
	iface, err := pq.queue.DequeueBlock()
	if err != nil {
		if err == dque.ErrQueueClosed {
			err = ErrQueueClosed
		}
		return nil, time.Time{}, "", err
	}

	wrappedFact, ok := iface.(*QueuedFact)
	if !ok || len(wrappedFact.FactBytes) == 0 {
		return nil, time.Time{}, "", errors.New("Dequeued object is not a QueuedFact instance or fact bytes is empty")
	}

	fact, err := parsers.ParseJson(wrappedFact.FactBytes)
	if err != nil {
		return nil, time.Time{}, "", fmt.Errorf("Error unmarshalling events.Fact from bytes: %v", err)
	}

	return fact, wrappedFact.DequeuedTime, wrappedFact.TokenId, nil
}

func (pq *PersistentQueue) Close() error {
	return pq.queue.Close()
}

func logSkippedEvent(fact Fact, err error) {
	logging.Warnf("Unable to enqueue object %v reason: %v. This object will be skipped", fact, err)
}
