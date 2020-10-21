package storages

import (
	"context"
	"io"
)

type Lock interface {
	Unlock(ctx context.Context) error
}

type MonitorKeeper interface {
	Lock(destinationName string, tableName string) (Lock, io.Closer, error)
	Unlock(lock Lock, closer io.Closer) error

	GetVersion(destinationName string, tableName string) (int64, error)
	IncrementVersion(destinationName string, tableName string) (int64, error)
}
