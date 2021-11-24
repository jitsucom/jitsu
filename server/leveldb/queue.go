package leveldb

import (
	"fmt"
	"github.com/jitsucom/goque/v2"
	"time"
)

type Queue struct {
	queue *goque.Queue
}

func NewQueue(dir string) (*Queue, error) {
	queue, err := goque.OpenQueue(dir)
	if err != nil {
		if goque.IsCorrupted(err) {
			queue, err = goque.RecoverQueue(dir)
			if err != nil {
				return nil, err
			}
		} else {
			return nil, err
		}
	}

	return &Queue{queue: queue}, nil
}

func (q *Queue) Size() int {
	return int(q.queue.Length())
}

func (q *Queue) Enqueue(object interface{}) error {
	if _, err := q.queue.EnqueueObject(object); err != nil {
		return err
	}

	return nil
}

//DequeueBlock accepts only pointers
func (q *Queue) DequeueBlock(object interface{}) error {
	item, err := q.dequeueBlock()
	if err != nil {
		return err
	}

	if err := item.ToObject(object); err != nil {
		return fmt.Errorf("error while deserializing object from queue: %v", err)
	}

	return nil
}

func (q *Queue) dequeueBlock() (*goque.Item, error) {
	for {
		item, err := q.queue.Dequeue()
		if err == goque.ErrEmpty {
			time.Sleep(50 * time.Millisecond)
			continue
		}

		return item, err
	}
}

//Close closes underlying queue
func (q *Queue) Close() error {
	return q.queue.Close()
}
