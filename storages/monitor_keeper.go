package storages

import (
	"context"
	"github.com/ksensehq/eventnative/logging"
	"io"
)

type ResourceLock interface {
	Unlock(ctx context.Context) error
}

type Lock interface {
	Unlock()
	Identifier() string
}

type MonitorKeeper interface {
	io.Closer
	//system: [source_id, destination_id], collection: [collectionName, tableName]

	Lock(system string, collection string) (Lock, error)
	Unlock(lock Lock) error

	GetVersion(system string, collection string) (int64, error)
	IncrementVersion(system string, collection string) (int64, error)
}

//RetryableLock hold lock, resource closer
//For unlocking with retryCount attempts
type RetryableLock struct {
	identifier     string
	resourceLock   ResourceLock
	resourceCloser io.Closer
	retryCount     int
}

//NewRetryableLock return RetryableLock
func NewRetryableLock(identifier string, resourceLock ResourceLock, resourceCloser io.Closer, retryCount int) *RetryableLock {
	return &RetryableLock{
		identifier:     identifier,
		resourceLock:   resourceLock,
		resourceCloser: resourceCloser,
		retryCount:     retryCount,
	}
}

//Unlock run retryCount unlock attempts
func (rl *RetryableLock) Unlock() {
	rl.unlockWithRetry(1)
}

//unlock with recursion if err
func (rl *RetryableLock) unlockWithRetry(retry int) {
	if err := rl.unlock(); err != nil {
		if retry == rl.retryCount {
			logging.Errorf("System error unlocking [%s] after %d tries: %v", rl.identifier, retry, err)
		} else {
			rl.unlockWithRetry(retry + 1)
		}
	}
}

//unlock release resources
func (rl *RetryableLock) unlock() error {
	ctx := context.Background()
	if err := rl.resourceLock.Unlock(ctx); err != nil {
		return err
	}

	if rl.resourceCloser != nil {
		if closeError := rl.resourceCloser.Close(); closeError != nil {
			logging.Error("Unlocked successfully but failed to close resource ", closeError)
		}
	}

	return nil
}

func (rl *RetryableLock) Identifier() string {
	return rl.identifier
}
