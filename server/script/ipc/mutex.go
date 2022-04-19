package ipc

import (
	"context"
	"sync"
)

// Mutex provides an interruptible mutex implementation.
type Mutex struct {
	taken chan bool
	once  sync.Once
}

// Lock attempts to lock the mutex in the given context.Context.
func (mu *Mutex) Lock(ctx context.Context) (unlock func(), err error) {
	mu.once.Do(func() { mu.taken = make(chan bool, 1) })
	select {
	case <-ctx.Done():
		return func() {}, ctx.Err()
	case mu.taken <- true:
		once := new(sync.Once)
		return func() { once.Do(func() { <-mu.taken }) }, nil
	}
}
