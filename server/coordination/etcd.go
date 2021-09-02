package coordination

import (
	"context"
	"errors"
	"fmt"
	"io"
	"strconv"
	"sync"
	"time"

	"github.com/jitsucom/jitsu/server/cluster"
	"github.com/jitsucom/jitsu/server/logging"
	"github.com/jitsucom/jitsu/server/safego"
	"github.com/jitsucom/jitsu/server/storages"
	clientv3 "go.etcd.io/etcd/client/v3"
	"go.etcd.io/etcd/client/v3/concurrency"
)

const instancePrefix = "en_instance_"

//ErrAlreadyLocked is about already locked resource in coordination service
var ErrAlreadyLocked = errors.New("Resource has been already locked")

//Service is an interface for coordination (locking, cluster management, etc)
type Service interface {
	io.Closer

	storages.MonitorKeeper
	cluster.Manager
}

//EtcdService - etcd implementation for Service
type EtcdService struct {
	serverName string
	ctx        context.Context
	client     *clientv3.Client

	mutex    sync.RWMutex
	unlockMe map[string]*storages.RetryableLock
	closed   bool
}

//NewEtcdService returns etcd service as a coordination layer
//starts EtcdService heart beat goroutine: see EtcdService.startHeartBeating()
//DEPRECATED
func NewEtcdService(ctx context.Context, serverName, endpoint string, connectTimeoutSeconds uint) (Service, error) {
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

	es := &EtcdService{ctx: ctx, serverName: serverName, client: client, unlockMe: map[string]*storages.RetryableLock{}}
	es.startHeartBeating()

	return es, nil
}

//Lock try to get Etcd monitor with timeout (2 minutes)
//wait if lock has been already acquired
func (es *EtcdService) Lock(system string, collection string) (storages.Lock, error) {
	ctx, cancel := context.WithDeadline(es.ctx, time.Now().Add(2*time.Minute))

	//the session depends on the context. We can't cancel() before unlock.
	session, sessionError := concurrency.NewSession(es.client, concurrency.WithContext(ctx))
	if sessionError != nil {
		cancel()
		return nil, sessionError
	}
	identifier := system + "_" + collection
	l := concurrency.NewMutex(session, identifier)

	if err := l.Lock(ctx); err != nil {
		cancel()
		return nil, err
	}

	lock := storages.NewRetryableLock(identifier, l, session, cancel, 5)

	es.mutex.Lock()
	es.unlockMe[identifier] = lock
	es.mutex.Unlock()

	return lock, nil
}

//TryLock try to get Etcd monitor with timeout (2 minutes)
//err if locked immediately
func (es *EtcdService) TryLock(system string, collection string) (storages.Lock, error) {
	ctx, cancel := context.WithDeadline(es.ctx, time.Now().Add(2*time.Minute))

	//the session depends on the context. We can't cancel() before unlock.
	session, sessionError := concurrency.NewSession(es.client, concurrency.WithContext(ctx))
	if sessionError != nil {
		cancel()
		return nil, sessionError
	}
	identifier := system + "_" + collection
	l := concurrency.NewMutex(session, identifier)

	if err := l.TryLock(ctx); err != nil {
		cancel()
		if err == concurrency.ErrLocked {
			return nil, ErrAlreadyLocked
		}

		return nil, err
	}

	lock := storages.NewRetryableLock(identifier, l, session, cancel, 5)

	es.mutex.Lock()
	es.unlockMe[identifier] = lock
	es.mutex.Unlock()

	return lock, nil
}

func (es *EtcdService) Unlock(lock storages.Lock) error {
	lock.Unlock()

	es.mutex.Lock()
	delete(es.unlockMe, lock.Identifier())
	es.mutex.Unlock()

	return nil
}

//IsLocked return true if already locked
func (es *EtcdService) IsLocked(system string, collection string) (bool, error) {
	l, err := es.TryLock(system, collection)
	if err != nil {
		if err == ErrAlreadyLocked {
			return true, nil
		}

		return false, err
	}

	defer l.Unlock()
	return false, nil
}

//GetVersion returns system collection version or error if occurred
func (es *EtcdService) GetVersion(system string, collection string) (int64, error) {
	ctx := context.Background()
	response, err := es.client.Get(ctx, system+"_"+collection)
	if err != nil {
		return -1, err
	}
	// Processing if key absents, thus initial version is requested
	if len(response.Kvs) == 0 {
		return 0, nil
	}
	version, err := strconv.ParseInt(string(response.Kvs[0].Value), 10, 64)
	if err != nil {
		return -1, err
	}
	return version, nil
}

func (es *EtcdService) IncrementVersion(system string, collection string) (int64, error) {
	version, err := es.GetVersion(system, collection)
	if err != nil {
		return -1, err
	}
	ctx := context.Background()
	version = version + 1
	_, putErr := es.client.Put(ctx, system+"_"+collection, strconv.FormatInt(version, 10))
	return version, putErr
}

//GetInstances returns instance names list from Etcd
func (es *EtcdService) GetInstances() ([]string, error) {
	r, err := es.client.Get(context.Background(), instancePrefix, clientv3.WithPrefix())
	if err != nil {
		return nil, fmt.Errorf("Error getting value from etcd: %v", err)
	}

	instances := []string{}
	for _, v := range r.Kvs {
		instances = append(instances, string(v.Value))
	}

	return instances, nil
}

//starts a new goroutine for pushing serverName every 90 seconds to etcd with 120 seconds Lease
func (es *EtcdService) startHeartBeating() {
	safego.RunWithRestart(func() {
		for {
			if es.closed {
				break
			}

			if err := es.heartBeat(); err != nil {
				logging.Errorf("Error heart beat to etcd: %v", err)
				//delay after error
				time.Sleep(10 * time.Second)
				continue
			}

			time.Sleep(90 * time.Second)
		}
	})
}

func (es *EtcdService) heartBeat() error {
	lease, err := es.client.Lease.Grant(context.Background(), 120)
	if err != nil {
		return fmt.Errorf("error creating Lease: %v", err)
	}

	_, err = es.client.Put(context.Background(), instancePrefix+es.serverName, es.serverName, clientv3.WithLease(lease.ID))
	if err != nil {
		return fmt.Errorf("error pushing value: %v", err)
	}

	return nil
}

//Close closes connection to Etcd and unlocks all locks
func (es *EtcdService) Close() error {
	es.closed = true

	es.mutex.Lock()
	for identifier, lock := range es.unlockMe {
		logging.Infof("Unlocking [%s]..", identifier)

		lock.Unlock()
	}
	es.mutex.Unlock()

	return nil
}
