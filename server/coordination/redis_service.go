package coordination

import (
	"context"
	"fmt"
	"strconv"
	"sync"
	"time"

	"github.com/go-redis/redis"
	"github.com/go-redsync/redsync/v4"
	redislib "github.com/go-redsync/redsync/v4/redis"
	"github.com/go-redsync/redsync/v4/redis/goredis"
	"github.com/jitsucom/jitsu/server/logging"
	"github.com/jitsucom/jitsu/server/storages"
)

type RedisService struct {
	closed    bool
	context   context.Context
	selfmutex sync.RWMutex
	unlockMe  map[string]*storages.RetryableLock

	client  *redis.Client
	pool    *redislib.Pool
	redsync *redsync.Redsync
}

type MutexProxy struct {
	mutex *redsync.Mutex
}

func (mp *MutexProxy) Unlock(context.Context) error {
	logging.Debugf("Unlock Mutex: %v", mp.mutex.Name())
	_, err := mp.mutex.Unlock()
	return err
}

func NewRedisService(ctx context.Context, serverName, host string, port int, password string) (Service, error) {
	service := RedisService{
		closed:    false,
		context:   ctx,
		selfmutex: sync.RWMutex{},
		unlockMe:  map[string]*storages.RetryableLock{},
		client:    nil,
		pool:      nil,
		redsync:   nil,
	}

	service.client = redis.NewClient(&redis.Options{
		Network:  "tcp",
		Addr:     host + ":" + strconv.Itoa(port),
		Password: password,
	})

	pool := goredis.NewPool(service.client)
	service.pool = &pool

	service.redsync = redsync.New(*service.pool)

	// Test connection
	pong, err := service.client.Ping().Result()
	if err != nil {
		return nil, fmt.Errorf("Error testing connection to Redis: %v", err)
	}
	if pong != "PONG" {
		return nil, fmt.Errorf("Wrong answer from connection to Redis: %v", pong)
	}

	return &service, nil
}

func (rs *RedisService) Close() error {
	rs.closed = true

	rs.selfmutex.Lock()
	for identifier, lock := range rs.unlockMe {
		logging.Infof("Unlocking [%s]..", identifier)
		lock.Unlock()
	}
	rs.selfmutex.Unlock()

	return nil
}

func (rs *RedisService) GetInstances() ([]string, error) {
	return nil, fmt.Errorf("GetInstances should be implemented")
}

func (rs *RedisService) GetVersion(system string, collection string) (int64, error) {
	key := system + "_" + collection
	response := rs.client.Get(key)
	_, err := response.Result()
	if err == redis.Nil {
		return 0, nil
	} else if err != nil {
		return -1, err
	}
	version, err := response.Int64()
	if err != nil {
		return -1, err
	}
	return version, nil
}

func (rs *RedisService) IncrementVersion(system string, collection string) (int64, error) {
	key := system + "_" + collection
	response := rs.client.Incr(key)
	version, err := response.Result()
	if err != nil {
		return -1, err
	}

	return version, nil
}

func (rs *RedisService) IsLocked(system string, collection string) (bool, error) {
	return false, fmt.Errorf("IsLocked should be implemented")
}

func (rs *RedisService) Lock(system string, collection string) (storages.Lock, error) {
	_, cancel := context.WithDeadline(rs.context, time.Now().Add(2*time.Minute))

	identifier := "mutex:" + system + "_" + collection
	logging.Debugf("Lock Mutex: %v", identifier)
	mutex := rs.redsync.NewMutex(identifier)
	if err := mutex.Lock(); err != nil {
		cancel()
		return nil, err
	}

	proxy := &MutexProxy{mutex: mutex}
	lock := storages.NewRetryableLock(identifier, proxy, nil, cancel, 5)

	rs.selfmutex.Lock()
	rs.unlockMe[identifier] = lock
	rs.selfmutex.Unlock()

	return lock, nil
}

func (rs *RedisService) TryLock(system string, collection string) (storages.Lock, error) {
	_, cancel := context.WithDeadline(rs.context, time.Now().Add(2*time.Minute))

	identifier := "mutex:" + system + "_" + collection
	mutex := rs.redsync.NewMutex(identifier)

	if err := mutex.Lock(); err != nil {
		cancel()
		return nil, err
	}

	proxy := &MutexProxy{mutex: mutex}
	lock := storages.NewRetryableLock(identifier, proxy, nil, cancel, 5)

	rs.selfmutex.Lock()
	rs.unlockMe[identifier] = lock
	rs.selfmutex.Unlock()

	return lock, nil
}

func (rs *RedisService) Unlock(lock storages.Lock) error {
	lock.Unlock()

	rs.selfmutex.Lock()
	delete(rs.unlockMe, lock.Identifier())
	rs.selfmutex.Unlock()

	return nil
}
