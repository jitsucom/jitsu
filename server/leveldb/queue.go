package leveldb

import (
	"fmt"
	"github.com/jitsucom/goque/v2"
	"reflect"
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
		}
		return nil, err
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

func (q *Queue) DequeueBlock(object interface{}) error {
	item, err := q.dequeueBlock()
	if err != nil {
		return err
	}

	value := object
	if reflect.ValueOf(object).Kind() != reflect.Ptr {
		value = &object
	}

	if err := item.ToObject(value); err != nil {
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
