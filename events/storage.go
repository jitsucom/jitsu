package events

import (
	"github.com/jitsucom/eventnative/typing"
	"io"
)

type Storage interface {
	io.Closer
	Store(fileName string, payload []byte) (int, error)
	StoreWithParseFunc(fileName string, payload []byte, parseFunc func([]byte) (map[string]interface{}, error)) (int, error)
	SyncStore([]map[string]interface{}) (int, error)
	Fallback(fact ...*FailedFact)
	ColumnTypesMapping() map[typing.DataType]string
	Name() string
	Type() string
}

type StorageProxy interface {
	io.Closer
	Get() (Storage, bool)
}
