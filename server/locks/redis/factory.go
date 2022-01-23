package redis

import (
	"context"
	"github.com/go-redsync/redsync/v4"
	rsyncpool "github.com/go-redsync/redsync/v4/redis/redigo"
	"github.com/jitsucom/jitsu/server/locks"
	"github.com/jitsucom/jitsu/server/meta"
	"github.com/jitsucom/jitsu/server/metrics"
)

//LockFactory is a Redis based LockFactory
type LockFactory struct {
	ctx          context.Context
	pool         *meta.RedisPool
	redsync      *redsync.Redsync
	errorMetrics *meta.ErrorMetrics
}

//NewLockFactory returns configured Redis based LockFactory
func NewLockFactory(ctx context.Context, pool *meta.RedisPool) *LockFactory {
	return &LockFactory{
		ctx:          ctx,
		pool:         pool,
		redsync:      redsync.New(rsyncpool.NewPool(pool.GetPool())),
		errorMetrics: meta.NewErrorMetrics(metrics.CoordinationRedisErrors),
	}
}

//CreateLock returns lock instance (not yet locked)
func (lf *LockFactory) CreateLock(name string) locks.Lock {
	return newLock(name, lf.ctx, lf.pool, lf.redsync, lf.errorMetrics)
}
