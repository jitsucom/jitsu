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
	"github.com/jitsucom/jitsu/server/telemetry"
)

type RedisService struct {
	closed      bool
	context     context.Context
	selfmutex   sync.RWMutex
	serverNames []string
	unlockMe    map[string]*storages.RetryableLock

	client  *redis.Client
	pool    *redislib.Pool
	redsync *redsync.Redsync
}

type MutexProxy struct {
	mutex *redsync.Mutex
}

func (mp *MutexProxy) Unlock(context context.Context) error {
	logging.Debugf("Unlock mutex: %v", mp.mutex.Name())
	_, err := mp.mutex.UnlockContext(context)
	return err
}

func NewRedisService(ctx context.Context, serverName string, host string, port int, password string) (Service, error) {
	logging.Info("Initializing coordination service...")
	service := RedisService{
		closed:      false,
		context:     ctx,
		selfmutex:   sync.RWMutex{},
		serverNames: []string{serverName},
		unlockMe:    map[string]*storages.RetryableLock{},
		client:      nil,
		pool:        nil,
		redsync:     nil,
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

	telemetry.Coordination("redis")
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

func (rs *RedisService) doLock(identifier string) (storages.Lock, error) {
	_, cancel := context.WithDeadline(rs.context, time.Now().Add(2*time.Minute))

	lock, ok := rs.unlockMe[identifier]
	if ok && lock != nil {
		cancel()
		return nil, fmt.Errorf("Mutex [%s] is already locked", identifier)
	}

	mutex := rs.redsync.NewMutex(identifier)
	if err := mutex.LockContext(rs.context); err != nil {
		cancel()
		return nil, err
	}

	proxy := &MutexProxy{mutex: mutex}
	lock = storages.NewRetryableLock(identifier, proxy, nil, cancel, 5)

	rs.selfmutex.Lock()
	rs.unlockMe[identifier] = lock
	rs.selfmutex.Unlock()

	return lock, nil
}

func (rs *RedisService) GetInstances() ([]string, error) {
	return rs.serverNames, nil
}

func (rs *RedisService) getMutexName(system string, collection string) string {
	return "mutex:" + system + "_" + collection
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
	lock, err := rs.Lock(system, collection)
	if err != nil {
		return true, err
	}

	defer lock.Unlock()
	return false, nil
}

func (rs *RedisService) Lock(system string, collection string) (storages.Lock, error) {
	var err error
	identifier := rs.getMutexName(system, collection)
	logging.Debugf("Lock mutex: %v", identifier)

	for i := 0; i < 5; i++ {
		lock, err := rs.doLock(identifier)
		if err != nil {
			logging.Debugf("[%d] Failed attempt to lock [%s]-[%s]: %v", i+1, system, collection, err)
			time.Sleep(time.Second)
		} else {
			return lock, nil
		}
	}

	return nil, err
}

func (rs *RedisService) TryLock(system string, collection string) (storages.Lock, error) {
	identifier := rs.getMutexName(system, collection)
	logging.Debugf("Lock mutex: %v", identifier)

	return rs.doLock(identifier)
}

func (rs *RedisService) Unlock(lock storages.Lock) error {
	lock.Unlock()

	rs.selfmutex.Lock()
	delete(rs.unlockMe, lock.Identifier())
	rs.selfmutex.Unlock()

	return nil
}
