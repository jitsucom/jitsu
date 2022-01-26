package inmemory

import (
	"time"
)

const defaultLockAttempts = 100

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

// TryLock Attempts to acquire lock within given amount of time. If lock is not free by
// that time, returns false. Otherwise, returns true
func (l *Lock) TryLock(timeout time.Duration) (bool, error) {
	currentAttempt := 0
	attemptTimeout := timeout / defaultLockAttempts

	for {
		_, loaded := l.lockFunc(l.name, true)
		if loaded {
			if timeout == 0 {
				break
			}
			if currentAttempt > defaultLockAttempts {
				break
			}
			currentAttempt++

			time.Sleep(attemptTimeout)
		} else {
			return true, nil
		}
	}

	return false, nil
}

//Unlock unlocks the key
func (l *Lock) Unlock() {
	l.unlockFunc(l.name)
}
