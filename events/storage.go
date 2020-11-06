package events

import (
	"io"
)

type Storage interface {
	io.Closer
	Store(fileName string, payload []byte) (int, error)
	SyncStore([]map[string]interface{}) (int, error)
	Name() string
	Type() string
}

type StorageProxy interface {
	io.Closer
	Get() (Storage, bool)
}
