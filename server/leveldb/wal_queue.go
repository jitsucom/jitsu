package leveldb

import (
	"encoding/json"
	tidwall "github.com/tidwall/wal"
	"sync/atomic"
	"time"
)

type WLQueue struct {
	queue *tidwall.Log

	first uint64
	last  uint64
}

func NewWLQueue(dir string) (*WLQueue, error) {
	// open a new log file
	log, err := tidwall.Open(dir, nil)
	if err != nil {
		return nil, err
	}

	first, _ := log.FirstIndex()
	last, _ := log.LastIndex()

	return &WLQueue{
		queue: log,
		first: first,
		last:  last,
	}, nil
}

func (q *WLQueue) Size() int {
	if q.first == 1 && q.last == 0 {
		return 0
	}

	return int(q.last - q.first)
}

func (q *WLQueue) Enqueue(object interface{}) error {
	last := atomic.AddUint64(&q.last, 1)
	b, _ := json.Marshal(object)
	if err := q.queue.Write(last, b); err != nil {
		return err
	}
	atomic.CompareAndSwapUint64(&q.first, 0, 1)

	return nil
}

//DequeueBlock accepts only pointers
func (q *WLQueue) DequeueBlock(object interface{}) error {
	newValue := atomic.AddUint64(&q.first, 1)

	b, err := q.dequeueBlock(newValue - 1)
	if err != nil {
		return err
	}

	if err := json.Unmarshal(b, object); err != nil {
		return err
	}

	return nil
}

func (q *WLQueue) dequeueBlock(first uint64) ([]byte, error) {
	for {
		b, err := q.queue.Read(first)
		if err != nil {
			if err == tidwall.ErrNotFound {
				time.Sleep(50 * time.Millisecond)
				continue
			}
			return nil, err
		}

		return b, nil
	}
}

//Close closes underlying queue
func (q *WLQueue) Close() error {
	return q.queue.Close()
}
