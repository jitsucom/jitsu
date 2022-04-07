package ipc

import (
	"context"
	"sync"
)

type Mutex struct {
	taken chan bool
	once  sync.Once
}

func (mu *Mutex) Lock(ctx context.Context) (func(), error) {
	mu.once.Do(func() { mu.taken = make(chan bool, 1) })
	select {
	case <-ctx.Done():
		return func() {}, ctx.Err()
	case mu.taken <- true:
		once := new(sync.Once)
		return func() { once.Do(func() { <-mu.taken }) }, nil
	}
}
