package cluster

import (
	"context"
	"fmt"
	clientv3 "go.etcd.io/etcd/client/v3"
	"io"
)

type EtcdManager struct {
	serverName string
	client     *clientv3.Client
	closer     io.Closer
}

//NewEtcdManager returned configured cluster.Manger based on Etcd implementation
func NewEtcdManager(serverName string, client *clientv3.Client) *EtcdManager {
	em := &EtcdManager{
		serverName: serverName,
		client:     client,
	}

	hb := newHeartbeat(em)
	hb.start()
	em.closer = hb
	return em
}

//GetInstances returns instance names list from Etcd
func (em *EtcdManager) GetInstances() ([]string, error) {
	r, err := em.client.Get(context.Background(), instancePrefix, clientv3.WithPrefix())
	if err != nil {
		return nil, fmt.Errorf("error getting value from etcd: %v", err)
	}

	instances := []string{}
	for _, v := range r.Kvs {
		instances = append(instances, string(v.Value))
	}

	return instances, nil
}

func (em *EtcdManager) heartbeat() error {
	lease, err := em.client.Lease.Grant(context.Background(), 120)
	if err != nil {
		return fmt.Errorf("error creating Lease in Etcd: %v", err)
	}

	_, err = em.client.Put(context.Background(), instancePrefix+em.serverName, em.serverName, clientv3.WithLease(lease.ID))
	if err != nil {
		return fmt.Errorf("error pushing value to Etcd: %v", err)
	}

	return nil
}

//Close closes heatBeating goroutine
func (em *EtcdManager) Close() error {
	return em.closer.Close()
}
