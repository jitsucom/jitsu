package events

import (
	"encoding/json"
	"fmt"
	"github.com/jitsucom/jitsu/server/metrics"
	"github.com/jitsucom/jitsu/server/parsers"
	"github.com/xtreding/goque/v2"
	"path"
	"time"
)

const errCreateQueueTemplate = "error opening/creating event queue in dir [%s]: %v"

type LevelDBQueue struct {
	identifier string
	queue      *goque.Queue
}

func NewLevelDBQueue(identifier, queueName, logEventPath string) (PersistentQueue, error) {
	queueDir := path.Join(logEventPath, queueName)
	queue, err := goque.OpenQueue(queueDir)
	if err != nil {
		if goque.IsCorrupted(err) {
			queue, err = goque.RecoverQueue(queueDir)
			if err != nil {
				return nil, fmt.Errorf(errCreateQueueTemplate, queueDir, err)
			}
		}
		return nil, fmt.Errorf(errCreateQueueTemplate, queueDir, err)
	}

	metrics.InitialStreamEventsQueueSize(identifier, int(queue.Length()))

	return &LevelDBQueue{queue: queue, identifier: identifier}, nil
}

func (ldq *LevelDBQueue) Consume(f map[string]interface{}, tokenID string) {
	ldq.ConsumeTimed(f, time.Now().UTC(), tokenID)
}

func (ldq *LevelDBQueue) ConsumeTimed(f map[string]interface{}, t time.Time, tokenID string) {
	factBytes, err := json.Marshal(f)
	if err != nil {
		logSkippedEvent(f, fmt.Errorf("Error marshalling events event: %v", err))
		return
	}

	// or
	if _, err := ldq.queue.EnqueueObject(QueuedEvent{FactBytes: factBytes, DequeuedTime: t, TokenID: tokenID}); err != nil {
		logSkippedEvent(f, fmt.Errorf("Error putting event event bytes to the persistent queue: %v", err))
		return
	}

	metrics.EnqueuedEvent(ldq.identifier)
}

func (ldq *LevelDBQueue) DequeueBlock() (Event, time.Time, string, error) {
	item, err := ldq.dequeueBlock()
	if err != nil {
		return nil, time.Time{}, "", err
	}

	metrics.DequeuedEvent(ldq.identifier)

	qe := &QueuedEvent{}
	if err := item.ToObject(qe); err != nil {
		return nil, time.Time{}, "", fmt.Errorf("error while deserializing event from queue: %v", err)
	}

	fact, err := parsers.ParseJSON(qe.FactBytes)
	if err != nil {
		return nil, time.Time{}, "", fmt.Errorf("Error unmarshalling events.Event from bytes: %v", err)
	}

	return fact, qe.DequeuedTime, qe.TokenID, nil
}

func (ldq *LevelDBQueue) dequeueBlock() (*goque.Item, error) {
	for {
		item, err := ldq.queue.Dequeue()
		if err == goque.ErrEmpty {
			time.Sleep(100 * time.Millisecond)
			continue
		}

		return item, err
	}
}

//Close closes underlying queue
func (ldq *LevelDBQueue) Close() error {
	return ldq.queue.Close()
}
