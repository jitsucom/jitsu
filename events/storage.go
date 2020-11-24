package events

import (
	"io"
)

type Storage interface {
	io.Closer
	Store(fileName string, payload []byte) (int, error)
	StoreWithParseFunc(fileName string, payload []byte, parseFunc func([]byte) (map[string]interface{}, error)) (int, error)
	SyncStore([]map[string]interface{}) (int, error)
	Fallback(fact ...*FailedFact)
	Name() string
	Type() string
}

type StorageProxy interface {
	io.Closer
	Get() (Storage, bool)
}
