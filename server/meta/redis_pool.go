package meta

import (
	"context"
	"fmt"

	"github.com/FZambia/sentinel"
	"github.com/gomodule/redigo/redis"
	"github.com/hashicorp/go-multierror"
	"github.com/pkg/errors"
)

//RedisPool is a wrapper for keeping redis.Pool and sentinel.Sentinel and close them
type RedisPool struct {
	pool     *redis.Pool
	sentinel *sentinel.Sentinel
}

//GetPool returns the underlying redigo pool
func (rp *RedisPool) GetPool() *redis.Pool {
	return rp.pool
}

//Get returns a connection from the pool
func (rp *RedisPool) Get() redis.Conn {
	return rp.pool.Get()
}

func (rp *RedisPool) GetContext(ctx context.Context) (redis.Conn, error) {
	if conn, err := rp.pool.GetContext(ctx); err != nil {
		return nil, errors.Wrap(err, "get redis conn")
	} else {
		return conn, nil
	}
}

//Close closes redis pool and sentinel if configured
func (rp *RedisPool) Close() (multiErr error) {
	if err := rp.pool.Close(); err != nil {
		multiErr = multierror.Append(multiErr, fmt.Errorf("error closing redis pool: %v", err))
	}

	if rp.sentinel != nil {
		if err := rp.sentinel.Close(); err != nil {
			multiErr = multierror.Append(multiErr, fmt.Errorf("error closing redis sentinel: %v", err))
		}
	}

	return
}
