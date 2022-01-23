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
	Lock(timeout time.Duration) error
	Unlock() bool
	TryLock() error
}
