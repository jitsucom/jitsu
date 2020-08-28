package events

import (
	"fmt"
	"github.com/joncrlsn/dque"
)

const eventsPerPersistedFile = 2000

type QueuedFact struct {
	FactBytes []byte
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
