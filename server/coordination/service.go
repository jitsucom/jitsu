package coordination

import (
	"context"
	"errors"
	"github.com/jitsucom/jitsu/server/cluster"
	"github.com/jitsucom/jitsu/server/locks"
	etcdlocks "github.com/jitsucom/jitsu/server/locks/etcd"
	inmemorylocks "github.com/jitsucom/jitsu/server/locks/inmemory"
	redislocks "github.com/jitsucom/jitsu/server/locks/redis"
	"github.com/jitsucom/jitsu/server/logging"
	"github.com/jitsucom/jitsu/server/meta"
	clientv3 "go.etcd.io/etcd/client/v3"
	"io"
	"time"
)

//Service is a coordination service which is responsible for all distributed operations like:
// - distributed locks
// - obtain cluster information
type Service struct {
	clusterManager cluster.Manager
	locksFactory   locks.LockFactory

	locksCloser      io.Closer
	connectionCloser io.Closer
}

//DEPRECATED
//NewEtcdService returns configured Etcd Service
func NewEtcdService(ctx context.Context, serverName, endpoint string, connectTimeoutSeconds uint) (*Service, error) {
	logging.Info("🛫 Initializing etcd coordination service...")
	if endpoint == "" {
		return nil, errors.New("'endpoint' is required parameter for type: etcd")
	}

	if connectTimeoutSeconds == 0 {
		connectTimeoutSeconds = 20
	}
	client, err := clientv3.New(clientv3.Config{
		DialTimeout: time.Duration(connectTimeoutSeconds) * time.Second,
		Endpoints:   []string{endpoint},
	})
	if err != nil {
		return nil, err
	}

	clusterManager := cluster.NewEtcdManager(serverName, client)
	locksFactory, locksCloser := etcdlocks.NewLockFactory(ctx, client)
	return &Service{
		clusterManager:   clusterManager,
		locksFactory:     locksFactory,
		locksCloser:      locksCloser,
		connectionCloser: client,
	}, nil
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
