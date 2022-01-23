package inmemory

import (
	"fmt"
	"github.com/go-redsync/redsync/v4"
	"github.com/jitsucom/jitsu/server/locks/base"
	"github.com/jitsucom/jitsu/server/logging"
	"sync"
	"time"
)

//Lock is an in-memory lock
type Lock struct {
	name  string
	locks *sync.Map
}

func newLock(name string, locks *sync.Map) *Lock {
	return &Lock{
		name:  name,
		locks: locks,
	}
}

//Lock obtains lock with wait timeout
func (l *Lock) Lock(timeout time.Duration) error {
	_, loaded := l.locks.LoadOrStore(l.name, true)
	if loaded {
		if retryCount >= 3 {
			return base.ErrAlreadyLocked
		}

		time.Sleep(time.Millisecond * 20)
		return ims.lockWithRetry(system, collection, retryCount+1)
	}

	return nil
}

//TryLock tries to obtain a lock with 1 retry without timeout
func (l *Lock) TryLock() error {
	return l.doLock(redsync.WithExpiry(defaultExpiration), redsync.WithRetryDelay(0), redsync.WithTries(1))
}

//doLock locks mutex with name with input expiration and retries configuration
//starts controller heartbeat
func (l *Lock) doLock(options ...redsync.Option) error {
	mutex := l.redsync.NewMutex(l.name, options...)
	if err := mutex.LockContext(l.ctx); err != nil {
		if err == redsync.ErrFailed {
			return base.ErrAlreadyLocked
		}

		return err
	}

	l.mutex = mutex

	//start controller for lock's heartbeat
	controller := NewController(l.name, defaultExpiration/2, l)
	l.controller = controller
	controller.StartHeartbeat()

	return nil
}

//Unlock tries to unlock with defaultUnlockRetries attempts
func (l *Lock) Unlock() bool {
	l.controller.Close()

	i := 0
	for i <= defaultUnlockRetries {
		i++
		result, err := l.mutex.Unlock()
		if err != nil {
			logging.SystemErrorf("error unlocking %s after %d attempts: %v", l.name, i, err)
			continue
		}

		return result
	}

	return false
}

//Extend extends the lock expiration
func (l *Lock) Extend() (bool, error) {
	return l.mutex.Extend()
}
