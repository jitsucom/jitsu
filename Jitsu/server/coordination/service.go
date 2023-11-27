package coordination

import (
	"context"
	"github.com/jitsucom/jitsu/server/cluster"
	"github.com/jitsucom/jitsu/server/locks"
	inmemorylocks "github.com/jitsucom/jitsu/server/locks/inmemory"
	redislocks "github.com/jitsucom/jitsu/server/locks/redis"
	"github.com/jitsucom/jitsu/server/logging"
	"github.com/jitsucom/jitsu/server/meta"
	"io"
	"time"
)

const CollectionLockTimeout = time.Minute

//Service is a coordination service which is responsible for all distributed operations like:
// - distributed locks
// - obtain cluster information
type Service struct {
	clusterManager cluster.Manager
	locksFactory   locks.LockFactory

	locksCloser      io.Closer
	connectionCloser io.Closer
}

//NewRedisService returns configured Redis Service
func NewRedisService(ctx context.Context, serverName string, factory *meta.RedisPoolFactory) (*Service, error) {
	logging.Infof("🛫 Initializing redis coordination service [%s]...", factory.Details())

	redisPool, err := factory.Create()
	if err != nil {
		return nil, err
	}

	lockFactory, locksCloser := redislocks.NewLockFactory(ctx, redisPool)

	return &Service{
		clusterManager:   cluster.NewRedisManager(serverName, redisPool),
		locksFactory:     lockFactory,
		locksCloser:      locksCloser,
		connectionCloser: redisPool,
	}, nil
}

//NewInMemoryService returns configured inmemory Service
func NewInMemoryService(serverName string) *Service {
	lockFactory, _ := inmemorylocks.NewLockFactory()
	return &Service{
		clusterManager:   cluster.NewInMemoryManager([]string{serverName}),
		locksFactory:     lockFactory,
		locksCloser:      nil,
		connectionCloser: nil,
	}
}

//GetJitsuInstancesInCluster proxies request to the clusters.Manager
func (s *Service) GetJitsuInstancesInCluster() ([]string, error) {
	return s.clusterManager.GetInstances()
}

//CreateLock proxies request to the locks.LockFactory
func (s *Service) CreateLock(name string) locks.Lock {
	return s.locksFactory.CreateLock(name)
}

func (s *Service) Close() error {
	if s.locksCloser != nil {
		return s.locksCloser.Close()
	}

	if s.connectionCloser != nil {
		return s.connectionCloser.Close()
	}

	return nil
}
