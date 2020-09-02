package storages

import (
	"time"
)

// 	"go.etcd.io/etcd/clientv3"

var (
	dialTimeout    = 2 * time.Second
	requestTimeout = 10 * time.Second
)

type MonitorKeeper interface {
	Lock(tableName string) error
	Unlock(tableName string) error

	GetVersion(tableName string) (int64, error)
	IncrementVersion(tableName string) (int64, error)
}

type DummyMonitorKeeper struct {
}

func (dmk *DummyMonitorKeeper) Lock(tableName string) error {
	return nil
}

func (dmk *DummyMonitorKeeper) Unlock(tableName string) error {
	return nil
}

func (dmk *DummyMonitorKeeper) GetVersion(tableName string) (int64, error) {
	return 1, nil
}

func (dmk *DummyMonitorKeeper) IncrementVersion(tableName string) (int64, error) {
	return 1, nil
}

// etcd lock implementation
//type EtcdMonitorKeeper struct {
//	dbPrefix string
//	ctx context.Context
//	keyValueStorage clientv3.KV
//}
//
//func (emk *EtcdMonitorKeeper) Lock(tableName string) error {
//
//	return nil
//}
//
//func (emk *EtcdMonitorKeeper) Unlock(tableName string) error {
//	return nil
//}
//
//func (emk *EtcdMonitorKeeper) GetVersion(tableName string) (int64, error) {
//	response, err := emk.keyValueStorage.Get(emk.ctx, emk.dbPrefix + "_" + tableName)
//	if err != nil {
//		return -1, err
//	}
//	version, err := strconv.ParseInt(string(response.Kvs[0].Value), 10, 64)
//	if err != nil {
//		return -1, err
//	}
//	return version, nil
//}
//
//func (emk *EtcdMonitorKeeper) IncrementVersion(tableName string) (int64, error) {
//	version, err := emk.GetVersion(tableName)
//	if err != nil {
//		return -1, err
//	}
//	//if version == nil {
//	//	_, err := emk.keyValueStorage.Put(emk.ctx, emk.dbPrefix + "_" + tableName, "1")
//	//	return 1, err
//	//}
//	version = version + 1
//	_, putErr := emk.keyValueStorage.Put(emk.ctx, emk.dbPrefix + "_" + tableName, strconv.FormatInt(version, 10))
//	return version, putErr
//}

func NewMonitorKeeper() MonitorKeeper {
	return &DummyMonitorKeeper{}
}

//func NewMonitorKeeperV2(dbPrefix string, syncServiceConfig map[string]string) (MonitorKeeper, error) {
//	if syncServiceConfig != nil && len(syncServiceConfig) > 0 {
//		if syncServiceConfig["type"] == "etcd" {
//			ctx, _ := context.WithTimeout(context.Background(), requestTimeout)
//			//if ctxError != nil {
//			//	return nil, ctxError
//			//}
//			cli, error := clientv3.New(clientv3.Config{
//				DialTimeout: dialTimeout,
//				Endpoints:   []string{syncServiceConfig["endpoint"]},
//			})
//			if error != nil {
//				return nil, error
//			}
//			keeper := &EtcdMonitorKeeper{}
//			keeper.ctx = ctx
//			keeper.keyValueStorage = cli.KV
//			keeper.dbPrefix = dbPrefix
//			return keeper, nil
//		} else {
//			return nil, errors.Unwrap(fmt.Errorf("Unknown sync service type: %w", syncServiceConfig["type"]))
//		}
//	}
//	return &DummyMonitorKeeper{}, nil
//}
