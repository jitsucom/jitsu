package redis

import (
	"github.com/jitsucom/jitsu/server/locks"
	"github.com/jitsucom/jitsu/server/logging"
	"sync"
)

//LocksCloser is designer for graceful closing all locks on server shutdown
type LocksCloser struct {
	mutex sync.Mutex
	locks map[string]locks.Lock
}

func NewLocksCloser() *LocksCloser {
	return &LocksCloser{
		mutex: sync.Mutex{},
		locks: map[string]locks.Lock{},
	}
}

func (lc *LocksCloser) Add(identifier string, lock locks.Lock) {
	lc.mutex.Lock()
	lc.locks[identifier] = lock
	lc.mutex.Unlock()
}

func (lc *LocksCloser) Remove(identifier string) {
	lc.mutex.Lock()
	delete(lc.locks, identifier)
	lc.mutex.Unlock()
}

func (lc *LocksCloser) Close() error {
	lc.mutex.Lock()
	for id, lock := range lc.locks {
		logging.Warnf("[graceful] unlocking %s ...", id)
		lock.Unlock()
	}
	lc.mutex.Unlock()

	return nil
}
