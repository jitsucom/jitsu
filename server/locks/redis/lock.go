package redis

import (
	"context"
	"github.com/go-redsync/redsync/v4"
	"github.com/jitsucom/jitsu/server/locks/base"
	"github.com/jitsucom/jitsu/server/logging"
	"github.com/jitsucom/jitsu/server/meta"
	"time"
)

//redis key [variables] - description
//** Locking **
//coordination:mutex#${identifier} - redsync key for locking

const (
	defaultRetries    = 10
	defaultExpiration = 8 * time.Second

	defaultUnlockRetries = 5
)

//Lock is a Redis lock
type Lock struct {
	mutexName    string
	ctx          context.Context
	pool         *meta.RedisPool
	redsync      *redsync.Redsync
	errorMetrics *meta.ErrorMetrics
	lockCloser   *base.LocksCloser

	//exist only after locking
	controller *LockController
	mutex      *redsync.Mutex
}

func newLock(name string, ctx context.Context, pool *meta.RedisPool, redsync *redsync.Redsync, errorMetrics *meta.ErrorMetrics,
	lockCloser *base.LocksCloser) *Lock {
	return &Lock{
		mutexName:    "coordination:mutex#" + name,
		ctx:          ctx,
		pool:         pool,
		redsync:      redsync,
		errorMetrics: errorMetrics,
		lockCloser:   lockCloser,
	}
}

//Lock obtains lock with wait timeout
func (l *Lock) Lock(timeout time.Duration) error {
	retryDelay := timeout / defaultRetries
	return l.doLock(redsync.WithExpiry(defaultExpiration), redsync.WithRetryDelay(retryDelay), redsync.WithTries(defaultRetries))
}

//TryLock tries to obtain a lock with 1 retry without timeout
func (l *Lock) TryLock() error {
	return l.doLock(redsync.WithExpiry(defaultExpiration), redsync.WithRetryDelay(0), redsync.WithTries(1))
}

//doLock locks mutex with getMutexName with input expiration and retries configuration
//starts controller heartbeat
func (l *Lock) doLock(options ...redsync.Option) error {
	mutex := l.redsync.NewMutex(l.mutexName, options...)
	if err := mutex.LockContext(l.ctx); err != nil {
		if err == redsync.ErrFailed {
			return base.ErrAlreadyLocked
		}

		return err
	}

	l.mutex = mutex

	//start controller for lock's heartbeat
	controller := NewController(l.mutexName, defaultExpiration/2, l)
	l.controller = controller
	controller.StartHeartbeat()

	l.lockCloser.Add(l.mutexName, l)

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
			logging.SystemErrorf("error unlocking %s after %d attempts: %v", l.mutexName, i, err)
			continue
		}

		l.lockCloser.Remove(l.mutexName)
		return result
	}

	return false
}

//Extend extends the lock expiration
func (l *Lock) Extend() (bool, error) {
	return l.mutex.Extend()
}
