package inmemory

import (
	"context"
	"github.com/go-redsync/redsync/v4"
	rsyncpool "github.com/go-redsync/redsync/v4/redis/redigo"
	"github.com/jitsucom/jitsu/server/locks"
	"github.com/jitsucom/jitsu/server/meta"
	"github.com/jitsucom/jitsu/server/metrics"
	"sync"
)

//LockFactory is an in-memory based LockFactory
type LockFactory struct {
	locks *sync.Map
}

//NewLockFactory returns configured Redis based LockFactory
func NewLockFactory() *LockFactory {
	return &LockFactory{
		locks: &sync.Map{},
	}
}

//CreateLock returns lock instance (not yet locked)
func (lf *LockFactory) CreateLock(name string) locks.Lock {
	return newLock(name, lf.locks)
}
