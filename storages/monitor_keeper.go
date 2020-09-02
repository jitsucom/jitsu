package storages

import (
	"context"
	"errors"
	"fmt"
	"go.etcd.io/etcd/clientv3"
	"strconv"
	"time"
)

var (
	dialTimeout    = 2 * time.Second
	requestTimeout = 10 * time.Second
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
	ctx             context.Context
	keyValueStorage clientv3.KV
}

func (emk *EtcdMonitorKeeper) Lock(dbType string, tableName string) error {

	return nil
}

func (emk *EtcdMonitorKeeper) Unlock(dbType string, tableName string) error {
	return nil
}

func (emk *EtcdMonitorKeeper) GetVersion(dbType string, tableName string) (int64, error) {
	response, err := emk.keyValueStorage.Get(emk.ctx, dbType+"_"+tableName)
	if err != nil {
		return -1, err
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
	//if version == nil {
	//	_, err := emk.keyValueStorage.Put(emk.ctx, emk.dbPrefix + "_" + tableName, "1")
	//	return 1, err
	//}
	version = version + 1
	_, putErr := emk.keyValueStorage.Put(emk.ctx, dbType+"_"+tableName, strconv.FormatInt(version, 10))
	return version, putErr
}

func NewMonitorKeeper(syncServiceType string, syncServiceEndpoint string) (MonitorKeeper, error) {
	if syncServiceType == "" || syncServiceEndpoint == "" {
		fmt.Println("Using stub sync server as no configuration is provided")
		return &DummyMonitorKeeper{}, nil
	}
	if syncServiceType == "etcd" {
		ctx, _ := context.WithTimeout(context.Background(), requestTimeout)
		cli, err := clientv3.New(clientv3.Config{
			DialTimeout: dialTimeout,
			Endpoints:   []string{syncServiceEndpoint},
		})
		if err != nil {
			return nil, err
		}
		keeper := &EtcdMonitorKeeper{}
		keeper.ctx = ctx
		keeper.keyValueStorage = cli.KV
		return keeper, nil
	} else {
		return nil, errors.Unwrap(fmt.Errorf("Unknown sync service type %s.", syncServiceType))
	}
}
