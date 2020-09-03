package storages

import (
	"context"
	"errors"
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
	Lock(dbType string, tableName string) (Lock, io.Closer, error)
	Unlock(lock Lock, closer io.Closer) error

	GetVersion(dbType string, tableName string) (int64, error)
	IncrementVersion(dbType string, tableName string) (int64, error)
}

type DummyMonitorKeeper struct {
}

func (dmk *DummyMonitorKeeper) Lock(dbType string, tableName string) (Lock, io.Closer, error) {
	return nil, nil, nil
}

func (dmk *DummyMonitorKeeper) Unlock(lock Lock, closer io.Closer) error {
	return nil
}

func (dmk *DummyMonitorKeeper) GetVersion(dbType string, tableName string) (int64, error) {
	return 1, nil
}

func (dmk *DummyMonitorKeeper) IncrementVersion(dbType string, tableName string) (int64, error) {
	return 1, nil
}

// etcd lock implementation
type EtcdMonitorKeeper struct {
	client *clientv3.Client
}

func (emk *EtcdMonitorKeeper) Lock(dbType string, tableName string) (Lock, io.Closer, error) {
	session, sessionError := concurrency.NewSession(emk.client)
	if sessionError != nil {
		return nil, nil, sessionError
	}
	l := concurrency.NewMutex(session, dbType+"_"+tableName)
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

func (emk *EtcdMonitorKeeper) GetVersion(dbType string, tableName string) (int64, error) {
	ctx := context.Background()
	kv := emk.client.KV
	response, err := kv.Get(ctx, dbType+"_"+tableName)
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

func (emk *EtcdMonitorKeeper) IncrementVersion(dbType string, tableName string) (int64, error) {
	version, err := emk.GetVersion(dbType, tableName)
	if err != nil {
		return -1, err
	}
	ctx := context.Background()
	kv := emk.client
	version = version + 1
	_, putErr := kv.Put(ctx, dbType+"_"+tableName, strconv.FormatInt(version, 10))
	return version, putErr
}

func NewMonitorKeeper(syncServiceType string, syncServiceEndpoint string, connectionTimeoutSeconds uint) (MonitorKeeper, error) {
	if syncServiceType == "" || syncServiceEndpoint == "" {
		fmt.Println("Using stub sync server as no configuration is provided")
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
		keeper := &EtcdMonitorKeeper{}
		keeper.client = cli
		return keeper, nil
	} else {
		return nil, errors.Unwrap(fmt.Errorf("Unknown sync service type %s.", syncServiceType))
	}
}
