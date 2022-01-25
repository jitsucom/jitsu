package coordination

/*
import (
	"context"
	"github.com/jitsucom/jitsu/server/logging"
	"io"
)

type ResourceLock interface {
	Unlock(ctx context.Context) error
}

type Lock interface {
	Unlock()
	Identifier() string
}

type Service interface {
	io.Closer
	//system values: [source_id, destination_id], collection values: [collectionName, tableName]

	//Lock waits if lock acquired
	Lock(system string, collection string) (Lock, error)
	//TryLock returns err if lock acquired
	TryLock(system string, collection string) (Lock, error)
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
	cancelFunc     context.CancelFunc
	retryCount     int
}

//NewRetryableLock return RetryableLock
func NewRetryableLock(identifier string, resourceLock ResourceLock, resourceCloser io.Closer, cancelFunc context.CancelFunc, retryCount int) *RetryableLock {
	return &RetryableLock{
		identifier:     identifier,
		resourceLock:   resourceLock,
		resourceCloser: resourceCloser,
		cancelFunc:     cancelFunc,
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
			logging.SystemErrorf("Unable to unlock [%s] after %d tries: %v", rl.identifier, retry, err)
		} else {
			rl.unlockWithRetry(retry + 1)
		}
	}
}

//unlock release resources.
//Note: should be done with background context (app context is closed on app shutdown)
func (rl *RetryableLock) unlock() error {
	ctx := context.Background()
	if err := rl.resourceLock.Unlock(ctx); err != nil {
		return err
	}

	if rl.resourceCloser != nil {
		if closeError := rl.resourceCloser.Close(); closeError != nil {
			logging.Errorf("%s unlocked successfully but failed to close resource: %v", rl.identifier, closeError)
		}
	}

	if rl.cancelFunc != nil {
		rl.cancelFunc()
	}

	return nil
}

func (rl *RetryableLock) Identifier() string {
	return rl.identifier
}
*/
