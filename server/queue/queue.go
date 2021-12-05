package queue

import (
	"errors"
	"io"
)

var (
	ErrQueueClosed = errors.New("queue is closed")
)

type Queue interface {
	io.Closer
	Push(interface{}) error
	Pop() (interface{}, error)
	Size() int64
}
