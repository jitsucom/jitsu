package events

import (
	"encoding/json"
	"fmt"
	"github.com/jitsucom/goque/v2"
	"github.com/jitsucom/jitsu/server/leveldb"
	"github.com/jitsucom/jitsu/server/metrics"
	"github.com/jitsucom/jitsu/server/parsers"
	"path"
	"time"
)

const errCreateQueueTemplate = "error opening/creating event queue in dir [%s]: %v"

type LevelDBQueue struct {
	identifier string
	queue      *leveldb.Queue
}

func NewLevelDBQueue(identifier, queueName, logEventPath string) (Queue, error) {
	queueDir := path.Join(logEventPath, queueName)
	queue, err := leveldb.NewQueue(queueDir)
	if err != nil {
		return nil, fmt.Errorf(errCreateQueueTemplate, queueDir, err)
	}

	metrics.InitialStreamEventsQueueSize(identifier, queue.Size())

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
	if err := ldq.queue.Enqueue(QueuedEvent{FactBytes: factBytes, DequeuedTime: t, TokenID: tokenID}); err != nil {
		logSkippedEvent(f, fmt.Errorf("Error putting event event bytes to the persistent queue: %v", err))
		return
	}

	metrics.EnqueuedEvent(ldq.identifier)
}

func (ldq *LevelDBQueue) DequeueBlock() (Event, time.Time, string, error) {
	qe := &QueuedEvent{}
	if err := ldq.queue.DequeueBlock(qe); err != nil {
		if err == goque.ErrDBClosed {
			return nil, time.Time{}, "", ErrQueueClosed
		}
		return nil, time.Time{}, "", err
	}

	metrics.DequeuedEvent(ldq.identifier)

	fact, err := parsers.ParseJSON(qe.FactBytes)
	if err != nil {
		return nil, time.Time{}, "", fmt.Errorf("Error unmarshalling events.Event from bytes: %v", err)
	}

	return fact, qe.DequeuedTime, qe.TokenID, nil
}

//Close closes underlying queue
func (ldq *LevelDBQueue) Close() error {
	return ldq.queue.Close()
}
