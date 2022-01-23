package etcd

import (
	"context"
	"github.com/jitsucom/jitsu/server/locks"
	clientv3 "go.etcd.io/etcd/client/v3"
)

//LockFactory is an Etcd based LockFactory
type LockFactory struct {
	ctx    context.Context
	client *clientv3.Client
}

//NewLockFactory returns configured Etcd based LockFactory
func NewLockFactory(ctx context.Context, client *clientv3.Client) *LockFactory {
	return &LockFactory{
		ctx:    ctx,
		client: client,
	}
}

//CreateLock returns lock instance (not yet locked)
func (lf *LockFactory) CreateLock(name string) locks.Lock {
	return newLock(name, lf.ctx, lf.client)
}
