package synchronization

import (
	"context"
	"fmt"
	"github.com/coreos/etcd/clientv3"
	"github.com/coreos/etcd/clientv3/concurrency"
	"github.com/ksensehq/eventnative/cluster"
	"github.com/ksensehq/eventnative/logging"
	"github.com/ksensehq/eventnative/storages"
	"io"
	"strconv"
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
	client     *clientv3.Client

	closed bool
}

//NewService return EtcdService (etcd) if was configured or Dummy otherwise
//starts EtcdService heart beat goroutine: see EtcdService.startHeartBeating()
func NewService(serverName, syncServiceType, syncServiceEndpoint string, connectionTimeoutSeconds uint) (Service, error) {
	if syncServiceType == "" || syncServiceEndpoint == "" {
		logging.Warn("Using dummy synchronization service as no configuration is provided")
		return &Dummy{serverNameSingleArray: []string{serverName}}, nil
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

		es := &EtcdService{serverName: serverName, client: client}
		es.startHeartBeating()

		logging.Info("Using etcd synchronization service")
		return es, nil

	default:
		return nil, fmt.Errorf("Unknown synchronization service type: %s", syncServiceType)
	}
}

func (es *EtcdService) Lock(destinationName string, tableName string) (storages.Lock, io.Closer, error) {
	session, sessionError := concurrency.NewSession(es.client)
	if sessionError != nil {
		return nil, nil, sessionError
	}
	l := concurrency.NewMutex(session, destinationName+"_"+tableName)
	ctx := context.Background()
	if err := l.Lock(ctx); err != nil {
		return nil, nil, err
	}
	return l, session, nil
}

func (es *EtcdService) Unlock(lock storages.Lock, closer io.Closer) error {
	ctx := context.Background()
	if err := lock.Unlock(ctx); err != nil {
		return err
	}
	if closer != nil {
		if closeError := closer.Close(); closeError != nil {
			logging.Error("Unlocked successfully but failed to close resource ", closeError)
		}
	}
	return nil
}

func (es *EtcdService) GetVersion(destinationName string, tableName string) (int64, error) {
	ctx := context.Background()
	response, err := es.client.Get(ctx, destinationName+"_"+tableName)
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

func (es *EtcdService) IncrementVersion(destinationName string, tableName string) (int64, error) {
	version, err := es.GetVersion(destinationName, tableName)
	if err != nil {
		return -1, err
	}
	ctx := context.Background()
	version = version + 1
	_, putErr := es.client.Put(ctx, destinationName+"_"+tableName, strconv.FormatInt(version, 10))
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
	go func() {
		for {
			if es.closed {
				break
			}

			if err := es.heartBeat(); err != nil {
				logging.Errorf("Error heart beat to etcd: %v", err)
				continue
			}

			time.Sleep(90 * time.Second)
		}
	}()
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

	return nil
}
