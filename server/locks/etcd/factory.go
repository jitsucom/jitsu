package etcd

import (
	"context"
	"github.com/jitsucom/jitsu/server/locks"
	"github.com/jitsucom/jitsu/server/locks/base"
	clientv3 "go.etcd.io/etcd/client/v3"
	"io"
)

//LockFactory is an Etcd based LockFactory
type LockFactory struct {
	ctx    context.Context
	client *clientv3.Client

	locksCloser *base.LocksCloser
}

//NewLockFactory returns configured Etcd based LockFactory
func NewLockFactory(ctx context.Context, client *clientv3.Client) (*LockFactory, io.Closer) {
	locksCloser := base.NewLocksCloser()
	return &LockFactory{
		ctx:         ctx,
		client:      client,
		locksCloser: locksCloser,
	}, locksCloser
}

//CreateLock returns lock instance (not yet locked)
func (lf *LockFactory) CreateLock(name string) locks.Lock {
	return newLock(name, lf.ctx, lf.client, lf.locksCloser)
}
