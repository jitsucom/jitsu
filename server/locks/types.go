package locks

import (
	"time"
)

//LockFactory creates lock and returns it (without locking)
type LockFactory interface {
	CreateLock(name string) Lock
}

//Lock all operations with lock
type Lock interface {
	// TryLock Attempts to acquire lock within given amount of time. If lock is not free by
	// that time, returns false. Otherwise, returns true
	TryLock(timeout time.Duration) (bool, error)
	Unlock()
}
