package storages

import (
	"context"
	"errors"
	"fmt"
	"go.etcd.io/etcd/clientv3"
	"strconv"
	"time"
)

type MonitorKeeper interface {
	Lock(dbType string, tableName string) error
	Unlock(dbType string, tableName string) error

	GetVersion(dbType string, tableName string) (int64, error)
	IncrementVersion(dbType string, tableName string) (int64, error)
}

type DummyMonitorKeeper struct {
}

func (dmk *DummyMonitorKeeper) Lock(dbType string, tableName string) error {
	return nil
}

func (dmk *DummyMonitorKeeper) Unlock(dbType string, tableName string) error {
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
	client         *clientv3.Client
	requestTimeout time.Duration
}

func (emk *EtcdMonitorKeeper) Lock(dbType string, tableName string) error {

	return nil
}

func (emk *EtcdMonitorKeeper) Unlock(dbType string, tableName string) error {
	return nil
}

func (emk *EtcdMonitorKeeper) GetVersion(dbType string, tableName string) (int64, error) {
	ctx, _ := context.WithTimeout(context.Background(), emk.requestTimeout)
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
	ctx, _ := context.WithTimeout(context.Background(), emk.requestTimeout*time.Second)
	kv := emk.client
	version = version + 1
	_, putErr := kv.Put(ctx, dbType+"_"+tableName, strconv.FormatInt(version, 10))
	return version, putErr
}

func NewMonitorKeeper(syncServiceType string, syncServiceEndpoint string, connectionTimeoutSeconds uint, requestTimeoutSeconds uint) (MonitorKeeper, error) {
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
		keeper.requestTimeout = time.Duration(requestTimeoutSeconds) * time.Second
		return keeper, nil
	} else {
		return nil, errors.Unwrap(fmt.Errorf("Unknown sync service type %s.", syncServiceType))
	}
}
