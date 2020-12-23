package events

import (
	"io"
)

type Storage interface {
	io.Closer
	Store(fileName string, payload []byte, alreadyUploadedTables map[string]bool) (map[string]*StoreResult, int, error)
	StoreWithParseFunc(fileName string, payload []byte, skipTables map[string]bool, parseFunc func([]byte) (map[string]interface{}, error)) (map[string]*StoreResult, int, error)
	SyncStore(tableName string, objects []map[string]interface{}, timeIntervalValue string) (int, error)
	Fallback(events ...*FailedEvent)
	Name() string
	Type() string
}

type StorageProxy interface {
	io.Closer
	Get() (Storage, bool)
}

type StoreResult struct {
	Err       error
	RowsCount int
}
