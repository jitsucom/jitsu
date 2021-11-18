package users

import (
	"fmt"
	"github.com/jitsucom/jitsu/server/metrics"
	"github.com/xtreding/goque/v2"
	"path"
	"time"
)

const errCreateQueueTemplate = "error opening/creating users queue in dir [%s]: %v"

type LevelDBQueue struct {
	queue *goque.Queue
}

func NewLevelDBQueue(queueName, logEventPath string) (*LevelDBQueue, error) {
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

	metrics.InitialUsersRecognitionQueueSize(int(queue.Length()))

	return &LevelDBQueue{queue: queue}, nil
}

func (ldq *LevelDBQueue) Enqueue(rp *RecognitionPayload) error {
	if _, err := ldq.queue.EnqueueObject(rp); err != nil {
		return err
	}

	metrics.EnqueuedRecognitionEvent()

	return nil
}

func (ldq *LevelDBQueue) DequeueBlock() (*RecognitionPayload, error) {
	item, err := ldq.dequeueBlock()
	if err != nil {
		return nil, err
	}

	metrics.DequeuedRecognitionEvent()

	rp := &RecognitionPayload{}
	if err := item.ToObject(rp); err != nil {
		return nil, fmt.Errorf("error while deserializing recognition payload from queue: %v", err)
	}

	return rp, nil
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
