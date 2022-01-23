package coordination

import (
	"context"
	"github.com/gomodule/redigo/redis"
	"github.com/jitsucom/jitsu/server/meta"
	"github.com/jitsucom/jitsu/server/metrics"
	"github.com/jitsucom/jitsu/server/safego"
	"github.com/jitsucom/jitsu/server/timestamp"
	"go.uber.org/atomic"
	"sync"
	"time"

	"github.com/go-redsync/redsync/v4"
	rsyncpool "github.com/go-redsync/redsync/v4/redis/redigo"
	"github.com/jitsucom/jitsu/server/logging"
	"github.com/jitsucom/jitsu/server/storages"
)

//redis key [variables] - description
//
//** Heart beat **
//cluster:heartbeat [serverName, timestamp] - hashtable with server instance names plus added timestamp utc
//
//** Versions **
//systems:versions [system_collection, version] - hashtable with system+collection pair versions
//
//** Locking **
//coordination:mutex#$system_$collection - redsync key for locking

const (
	heartbeatKey                 = "cluster:heartbeat"
	systemsCollectionVersionsKey = "systems:versions"
)

// Options for RedisService
type Options struct {
	DisableHeartBeating bool
	LockExpire          time.Duration
	LockRetry           int
	LockRetryDelay      time.Duration
}

// DefaultOptions for RedisService
var DefaultOptions = Options{
	DisableHeartBeating: false,
	LockExpire:          3 * time.Hour,
	LockRetry:           24,
	LockRetryDelay:      5 * time.Second,
}

//RedisService is a Redis implementation for coordination Service
type RedisService struct {
	ctx        context.Context
	serverName string
	options    Options
	selfmutex  sync.RWMutex
	unlockMe   map[string]*storages.RetryableLock

	pool         *meta.RedisPool
	redsync      *redsync.Redsync
	errorMetrics *meta.ErrorMetrics

	closed *atomic.Bool
}

//MutexProxy is used as a ResourceLock
type MutexProxy struct {
	mutex *redsync.Mutex
}

//Unlock unlocks mutex
func (mp *MutexProxy) Unlock(context context.Context) error {

	_, err := mp.mutex.UnlockContext(context)
	return err
}

//NewRedisService returns configured RedisService instance
func NewRedisService(ctx context.Context, serverName string, factory *meta.RedisPoolFactory, options Options) (Service, error) {
	logging.Infof("🛫 Initializing redis coordination service [%s]...", factory.Details())

	redisPool, err := factory.Create()
	if err != nil {
		return nil, err
	}

	redisSync := redsync.New(rsyncpool.NewPool(redisPool.GetPool()))

	rs := &RedisService{
		ctx:          ctx,
		selfmutex:    sync.RWMutex{},
		serverName:   serverName,
		options:      options,
		unlockMe:     map[string]*storages.RetryableLock{},
		pool:         redisPool,
		redsync:      redisSync,
		errorMetrics: meta.NewErrorMetrics(metrics.CoordinationRedisErrors),
		closed:       atomic.NewBool(false),
	}
	if !options.DisableHeartBeating {
		rs.startHeartBeating()
	}

	return rs, nil
}

//GetInstances returns instance names list from Redis
func (rs *RedisService) GetInstances() ([]string, error) {
	connection := rs.pool.Get()
	defer connection.Close()

	instancesMap, err := redis.StringMap(connection.Do("HGETALL", heartbeatKey))
	if err != nil && err != redis.ErrNil {
		rs.errorMetrics.NoticeError(err)
		return nil, err
	}

	instances := []string{}
	for instance, lastHeartbeatTime := range instancesMap {
		t, err := time.Parse(time.RFC3339Nano, lastHeartbeatTime)
		if err != nil {
			logging.SystemErrorf("Error parsing instance [%s] heartbeat time [%s] string into time: %v", instance, lastHeartbeatTime, err)
			continue
		}

		//account only instances with last heartbeat less than 2 minutes ago
		if timestamp.Now().UTC().Sub(t).Seconds() <= 120 {
			instances = append(instances, instance)
		}
	}

	return instances, nil
}

//GetVersion returns system collection version or error if occurred
func (rs *RedisService) GetVersion(system string, collection string) (int64, error) {
	connection := rs.pool.Get()
	defer connection.Close()

	field := system + "_" + collection
	version, err := redis.Int64(connection.Do("HGET", systemsCollectionVersionsKey, field))
	if err != nil {
		if err == redis.ErrNil {
			return 0, nil
		}

		rs.errorMetrics.NoticeError(err)
		return 0, err
	}

	return version, nil
}

//IncrementVersion increments system collection version
//returns new version or error if occurred
func (rs *RedisService) IncrementVersion(system string, collection string) (int64, error) {
	conn := rs.pool.Get()
	defer conn.Close()

	field := system + "_" + collection
	newVersion, err := redis.Int64(conn.Do("HINCRBY", systemsCollectionVersionsKey, field, 1))
	if err != nil && err != redis.ErrNil {
		rs.errorMetrics.NoticeError(err)
		return 0, err
	}

	return newVersion, nil
}

//Lock creates mutex and locks it with 3 hours expiration
//waits 2 minutes if locked
func (rs *RedisService) Lock(system string, collection string) (storages.Lock, error) {
	return rs.doLock(system, collection, redsync.WithExpiry(rs.options.LockExpire), redsync.WithRetryDelay(rs.options.LockRetryDelay), redsync.WithTries(rs.options.LockRetry))
}

//TryLock creates mutex and locks it with 3 hours expiration
//doesn't wait if locked
func (rs *RedisService) TryLock(system string, collection string) (storages.Lock, error) {
	lock, err := rs.doLock(system, collection, redsync.WithExpiry(rs.options.LockExpire), redsync.WithRetryDelay(0), redsync.WithTries(1))
	if err != nil {
		if err == redsync.ErrFailed {
			return nil, ErrAlreadyLocked
		}

		return nil, err
	}

	return lock, nil
}

//Unlock unlocks mutex and removes it from unlockMe
func (rs *RedisService) Unlock(lock storages.Lock) error {
	lock.Unlock()

	rs.selfmutex.Lock()
	delete(rs.unlockMe, lock.Identifier())
	rs.selfmutex.Unlock()

	return nil
}

//Close closes connection to Redis and unlocks all locks
func (rs *RedisService) Close() error {
	rs.closed.Store(true)

	rs.selfmutex.Lock()
	for identifier, lock := range rs.unlockMe {
		logging.Infof("Unlocking [%s]..", identifier)
		lock.Unlock()
	}
	rs.selfmutex.Unlock()

	return rs.pool.Close()
}

//doLock locks mutex with system + collection identifier with input expiration, retries configuration
func (rs *RedisService) doLock(system string, collection string, options ...redsync.Option) (storages.Lock, error) {
	identifier := rs.getMutexName(system, collection)

	mutex := rs.redsync.NewMutex(identifier, options...)
	if err := mutex.LockContext(rs.ctx); err != nil {
		return nil, err
	}

	proxy := &MutexProxy{mutex: mutex}
	lock := storages.NewRetryableLock(identifier, proxy, nil, nil, 5)

	rs.selfmutex.Lock()
	rs.unlockMe[identifier] = lock
	rs.selfmutex.Unlock()

	return lock, nil
}

//getMutexName returns mutex key
func (rs *RedisService) getMutexName(system string, collection string) string {
	return "coordination:mutex#" + system + "_" + collection
}

//starts a new goroutine for pushing serverName every 90 seconds to Redis with 120 seconds ttl
func (rs *RedisService) startHeartBeating() {
	safego.RunWithRestart(func() {
		for {
			if rs.closed.Load() {
				break
			}

			if err := rs.heartBeat(); err != nil {
				logging.Errorf("Error heart beat to redis: %v", err)
				//delay after error
				time.Sleep(10 * time.Second)
				continue
			}

			time.Sleep(90 * time.Second)
		}
	})
}

//heartBeat writes timestamp with server name under key
//Instances are considered alive if timestamp < now minus 120 seconds
func (rs *RedisService) heartBeat() error {
	field := rs.serverName
	connection := rs.pool.Get()
	defer connection.Close()

	_, err := connection.Do("HSET", heartbeatKey, field, timestamp.NowUTC())
	if err != nil && err != redis.ErrNil {
		rs.errorMetrics.NoticeError(err)
		return err
	}

	return nil
}
