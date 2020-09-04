package storages

import (
	"context"
	"fmt"
	"github.com/coreos/etcd/clientv3"
	"github.com/coreos/etcd/clientv3/concurrency"
	"io"
	"log"
	"strconv"
	"time"
)

type Lock interface {
	Unlock(ctx context.Context) error
}

type MonitorKeeper interface {
	Lock(destinationName string, tableName string) (Lock, io.Closer, error)
	Unlock(lock Lock, closer io.Closer) error

	GetVersion(destinationName string, tableName string) (int64, error)
	IncrementVersion(destinationName string, tableName string) (int64, error)
}

type DummyMonitorKeeper struct {
}

func (dmk *DummyMonitorKeeper) Lock(destinationName string, tableName string) (Lock, io.Closer, error) {
	return nil, nil, nil
}

func (dmk *DummyMonitorKeeper) Unlock(lock Lock, closer io.Closer) error {
	return nil
}

func (dmk *DummyMonitorKeeper) GetVersion(destinationName string, tableName string) (int64, error) {
	return 1, nil
}

func (dmk *DummyMonitorKeeper) IncrementVersion(destinationName string, tableName string) (int64, error) {
	return 1, nil
}

// etcd lock implementation
type EtcdMonitorKeeper struct {
	client *clientv3.Client
}

func (emk *EtcdMonitorKeeper) Lock(destinationName string, tableName string) (Lock, io.Closer, error) {
	session, sessionError := concurrency.NewSession(emk.client)
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

func (emk *EtcdMonitorKeeper) Unlock(lock Lock, closer io.Closer) error {
	ctx := context.Background()
	if err := lock.Unlock(ctx); err != nil {
		return err
	}
	if closer != nil {
		if closeError := closer.Close(); closeError != nil {
			log.Println("Unlocked successfully but failed to close resource ", closeError)
		}
	}
	return nil
}

func (emk *EtcdMonitorKeeper) GetVersion(destinationName string, tableName string) (int64, error) {
	ctx := context.Background()
	response, err := emk.client.KV.Get(ctx, destinationName+"_"+tableName)
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

func (emk *EtcdMonitorKeeper) IncrementVersion(destinationName string, tableName string) (int64, error) {
	version, err := emk.GetVersion(destinationName, tableName)
	if err != nil {
		return -1, err
	}
	ctx := context.Background()
	kv := emk.client
	version = version + 1
	_, putErr := kv.Put(ctx, destinationName+"_"+tableName, strconv.FormatInt(version, 10))
	return version, putErr
}

func NewMonitorKeeper(syncServiceType string, syncServiceEndpoint string, connectionTimeoutSeconds uint) (MonitorKeeper, error) {
	if syncServiceType == "" || syncServiceEndpoint == "" {
		log.Println("Using stub sync server as no configuration is provided")
		return &DummyMonitorKeeper{}, nil
	}
	if syncServiceType == "etcd" {
		cli, err := clientv3.New(clientv3.Config{
			DialTimeout: time.Duration(connectionTimeoutSeconds) * time.Second,
			Endpoints:   []string{syncServiceEndpoint},
		})
		if err != nil {
			return nil, err
		}
		return &EtcdMonitorKeeper{client: cli}, nil
	} else {
		return nil, fmt.Errorf("Unknown sync service type ", syncServiceType)
	}
}
