package redis

import (
	"context"
	"github.com/go-redsync/redsync/v4"
	"github.com/jitsucom/jitsu/server/logging"
	"github.com/jitsucom/jitsu/server/meta"
	"time"
)

//redis key [variables] - description
//** Locking **
//coordination:mutex#${identifier} - redsync key for locking

const (
	defaultRetries    = 100
	defaultExpiration = 8 * time.Second

	defaultUnlockRetries = 20
)

//Lock is a Redis lock
type Lock struct {
	mutexName    string
	ctx          context.Context
	pool         *meta.RedisPool
	redsync      *redsync.Redsync
	errorMetrics *meta.ErrorMetrics
	lockCloser   *LocksCloser

	//exist only after locking
	controller *LockController
	mutex      *redsync.Mutex
}

func newLock(name string, ctx context.Context, pool *meta.RedisPool, redsync *redsync.Redsync, errorMetrics *meta.ErrorMetrics,
	lockCloser *LocksCloser) *Lock {
	return &Lock{
		mutexName:    "coordination:mutex#" + name,
		ctx:          ctx,
		pool:         pool,
		redsync:      redsync,
		errorMetrics: errorMetrics,
		lockCloser:   lockCloser,
	}
}

// TryLock Attempts to acquire lock within given amount of time. If lock is not free by
// that time, returns false. Otherwise, returns true
func (l *Lock) TryLock(timeout time.Duration) (bool, error) {
	if timeout == 0 {
		return l.doLock(redsync.WithExpiry(defaultExpiration), redsync.WithRetryDelay(0), redsync.WithTries(1))
	}

	retryDelay := timeout / defaultRetries
	return l.doLock(redsync.WithExpiry(defaultExpiration), redsync.WithRetryDelay(retryDelay), redsync.WithTries(defaultRetries))
}

//doLock locks mutex with getMutexName with input expiration and retries configuration
//starts controller heartbeat
func (l *Lock) doLock(options ...redsync.Option) (bool, error) {
	mutex := l.redsync.NewMutex(l.mutexName, options...)
	if err := mutex.LockContext(l.ctx); err != nil {
		if err == redsync.ErrFailed {
			return false, nil
		}

		return false, err
	}

	l.mutex = mutex

	//start controller for lock's heartbeat
	controller := NewController(l.mutexName, defaultExpiration/2, l)
	l.controller = controller
	controller.StartHeartbeat()

	l.lockCloser.Add(l.mutexName, l)

	return true, nil
}

//Unlock tries to unlock with defaultUnlockRetries attempts
func (l *Lock) Unlock() {
	l.controller.Close()

	i := 0
	var err error
	for i < defaultUnlockRetries {
		i++
		_, err = l.mutex.Unlock()
		if err == nil {
			l.lockCloser.Remove(l.mutexName)
			return
		}
	}
	logging.SystemErrorf("error unlocking %s after %d attempts: %v", l.mutexName, i, err)
}

//Extend extends the lock expiration
func (l *Lock) Extend() (bool, error) {
	return l.mutex.Extend()
}
