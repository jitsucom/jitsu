package synchronization

import (
	"context"
	"fmt"
	"github.com/coreos/etcd/clientv3"
	"github.com/coreos/etcd/clientv3/concurrency"
	"github.com/jitsucom/eventnative/cluster"
	"github.com/jitsucom/eventnative/logging"
	"github.com/jitsucom/eventnative/safego"
	"github.com/jitsucom/eventnative/storages"
	"io"
	"strconv"
	"sync"
	"time"
)

const instancePrefix = "en_instance_"

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

//NewService return EtcdService (etcd) if was configured or InMemoryService otherwise
//starts EtcdService heart beat goroutine: see EtcdService.startHeartBeating()
func NewService(ctx context.Context, serverName, syncServiceType, syncServiceEndpoint string, connectionTimeoutSeconds uint) (Service, error) {
	if syncServiceType == "" || syncServiceEndpoint == "" {
		logging.Warn("Using in-memory synchronization service so as no configuration is provided")
		return NewInMemoryService([]string{serverName}), nil
	}

	switch syncServiceType {
	case "etcd":
		client, err := clientv3.New(clientv3.Config{
			DialTimeout: time.Duration(connectionTimeoutSeconds) * time.Second,
			Endpoints:   []string{syncServiceEndpoint},
		})
		if err != nil {
			return nil, err
		}

		es := &EtcdService{ctx: ctx, serverName: serverName, client: client, unlockMe: map[string]*storages.RetryableLock{}}
		es.startHeartBeating()

		logging.Info("Using etcd synchronization service")
		return es, nil

	default:
		return nil, fmt.Errorf("Unknown synchronization service type: %s", syncServiceType)
	}
}

//Lock try to get Etcd monitor with timeout (30 seconds)
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

func (es *EtcdService) Unlock(lock storages.Lock) error {
	lock.Unlock()

	es.mutex.Lock()
	delete(es.unlockMe, lock.Identifier())
	es.mutex.Unlock()

	return nil
}

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
