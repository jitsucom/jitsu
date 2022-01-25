package inmemory

import (
	"github.com/jitsucom/jitsu/server/locks/base"
	"time"
)

const defaultLockAttempts = 10

type inmemoryLockFunc func(key, value interface{}) (actual interface{}, loaded bool)
type inmemoryUnlockFunc func(key interface{})

//Lock is an in-memory lock
type Lock struct {
	name       string
	lockFunc   inmemoryLockFunc
	unlockFunc inmemoryUnlockFunc
}

func newLock(name string, lockFunc inmemoryLockFunc, unlockFunc inmemoryUnlockFunc) *Lock {
	return &Lock{
		name:       name,
		lockFunc:   lockFunc,
		unlockFunc: unlockFunc,
	}
}

//Lock obtains lock with wait timeout
func (l *Lock) Lock(timeout time.Duration) error {
	currentAttempt := 0
	attemptTimeout := timeout / defaultLockAttempts

	for {
		_, loaded := l.lockFunc(l.name, true)
		if loaded {
			if currentAttempt > defaultLockAttempts {
				break
			}
			currentAttempt++

			time.Sleep(attemptTimeout)
		} else {
			return nil
		}
	}

	return base.ErrAlreadyLocked
}

//TryLock tries to obtain a lock with 1 retry without timeout
func (l *Lock) TryLock() error {
	_, loaded := l.lockFunc(l.name, true)
	if loaded {
		return base.ErrAlreadyLocked
	}

	return nil
}

//Unlock unlocks the key
func (l *Lock) Unlock() bool {
	l.unlockFunc(l.name)
	return true
}
