package queue

import (
	"errors"
	"io"
)

const (
	RedisType    = "redis"
	InMemoryType = "inmemory"
)

var (
	ErrQueueClosed = errors.New("queue is closed")
)

type Queue interface {
	io.Closer
	Push(interface{}) error
	Pop() (interface{}, error)
	Size() int64
	BufferSize() int64
	Type() string
}
