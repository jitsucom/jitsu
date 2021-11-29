package users

import (
	"fmt"
	"github.com/jitsucom/jitsu/server/leveldb"
	"github.com/jitsucom/jitsu/server/metrics"
	"path"
)

const errCreateQueueTemplate = "error opening/creating users queue in dir [%s]: %v"

type LevelDBQueue struct {
	queue *leveldb.WLQueue
}

func NewLevelDBQueue(queueName, logEventPath string) (*LevelDBQueue, error) {
	queueDir := path.Join(logEventPath, queueName)
	queue, err := leveldb.NewWLQueue(queueDir)
	if err != nil {
		return nil, fmt.Errorf(errCreateQueueTemplate, queueDir, err)
	}

	metrics.InitialUsersRecognitionQueueSize(queue.Size())

	return &LevelDBQueue{queue: queue}, nil
}

func (ldq *LevelDBQueue) Enqueue(rp *RecognitionPayload) error {
	if err := ldq.queue.Enqueue(rp); err != nil {
		return err
	}

	metrics.EnqueuedRecognitionEvent()

	return nil
}

func (ldq *LevelDBQueue) DequeueBlock() (*RecognitionPayload, error) {
	rp := &RecognitionPayload{}

	if err := ldq.queue.DequeueBlock(rp); err != nil {
		return nil, err
	}

	metrics.DequeuedRecognitionEvent()

	return rp, nil
}

//Close closes underlying queue
func (ldq *LevelDBQueue) Close() error {
	return ldq.queue.Close()
}
