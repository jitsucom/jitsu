package inmemory

import (
	"github.com/jitsucom/jitsu/server/locks"
	"github.com/jitsucom/jitsu/server/locks/base"
	"io"
	"sync"
)

//LockFactory is an in-memory based LockFactory
type LockFactory struct {
	locks *sync.Map
}

//NewLockFactory returns configured Redis based LockFactory
func NewLockFactory() (*LockFactory, io.Closer) {
	lc := base.NewLocksCloser()
	return &LockFactory{
		locks: &sync.Map{},
	}, lc
}

//CreateLock returns lock instance (not yet locked)
func (lf *LockFactory) CreateLock(name string) locks.Lock {
	return newLock(name, lf.locks.LoadOrStore, lf.locks.Delete)
}

func (lf *LockFactory) Close() error {
	return nil
}
