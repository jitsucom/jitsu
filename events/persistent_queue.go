package events

import (
	"encoding/json"
	"errors"
	"fmt"
	"github.com/joncrlsn/dque"
	"github.com/ksensehq/eventnative/logging"
	"time"
)

const eventsPerPersistedFile = 2000

type QueuedFact struct {
	FactBytes  []byte
	QueuedTime time.Time
}

// QueuedFactBuilder creates and returns a new events.Fact.
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

func (pq *PersistentQueue) Consume(f Fact) {
	pq.ConsumeTimed(f, time.Now())
}

func (pq *PersistentQueue) ConsumeTimed(f Fact, t time.Time) {
	factBytes, err := json.Marshal(f)
	if err != nil {
		logSkippedEvent(f, fmt.Errorf("Error marshalling events fact: %v", err))
		return
	}

	if err := pq.queue.Enqueue(QueuedFact{FactBytes: factBytes, QueuedTime: t}); err != nil {
		logSkippedEvent(f, fmt.Errorf("Error putting event fact bytes to the persistent queue: %v", err))
		return
	}
}

func (pq *PersistentQueue) DequeueBlock() (Fact, time.Time, error) {
	iface, err := pq.queue.DequeueBlock()
	if err != nil {
		return nil, time.Time{}, err
	}
	wrappedFact, ok := iface.(QueuedFact)
	if !ok || len(wrappedFact.FactBytes) == 0 {
		return nil, time.Time{}, errors.New("Dequeued object is not a QueuedFact instance or fact bytes is empty")
	}

	fact := Fact{}
	err = json.Unmarshal(wrappedFact.FactBytes, &fact)
	if err != nil {
		return nil, time.Time{}, fmt.Errorf("Error unmarshalling events.Fact from bytes: %v", err)
	}

	return fact, wrappedFact.QueuedTime, nil
}

func (pq *PersistentQueue) Close() error {
	return pq.queue.Close()
}

func logSkippedEvent(fact Fact, err error) {
	logging.Warnf("Unable to enqueue object %v reason: %v. This object will be skipped", fact, err)
}
