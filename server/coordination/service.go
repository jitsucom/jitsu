package coordination

import (
	"github.com/jitsucom/jitsu/server/cluster"
	"github.com/jitsucom/jitsu/server/locks"
	"github.com/jitsucom/jitsu/server/logging"
)

//Service is a coordination service which is responsible for all distributed operations like:
// - distributed locks
// - obtain cluster information
// - obtain version of distributed objects (such as tables)
type Service struct {
	clusterManager      cluster.Manager
	locksFactory        locks.LockFactory
	tableVersionManager TableVersionManager
}

func NewEtcdService() {
	logging.Info("🛫 Initializing etcd coordination service...")

}

func NewRedisService() {
	logging.Infof("🛫 Initializing redis coordination service [%s]...", factory.Details())

}

//GetJitsuInstancesInCluster returns all Jitsu nodes from current cluster
func (s *Service) GetJitsuInstancesInCluster() ([]string, error) {
	return s.clusterManager.GetInstances()
}

//CreateLock creates a lock with the name
func (s *Service) CreateLock(name string) locks.Lock {
	return s.locksFactory.CreateLock(name)
}
