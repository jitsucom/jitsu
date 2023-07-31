package cluster

import (
	"github.com/gomodule/redigo/redis"
	"github.com/jitsucom/jitsu/server/logging"
	"github.com/jitsucom/jitsu/server/meta"
	"github.com/jitsucom/jitsu/server/metrics"
	"github.com/jitsucom/jitsu/server/timestamp"
	"io"
	"time"
)

//redis key [variables] - description
//** Heart beat **
//cluster:heartbeat [serverName, timestamp] - hashtable with server instance names plus added timestamp utc

const heartbeatKey = "cluster:heartbeat"

type RedisManager struct {
	serverName   string
	pool         *meta.RedisPool
	errorMetrics *meta.ErrorMetrics
	closer       io.Closer
}

//NewRedisManager returned configured cluster.Manger based on Redis implementation
func NewRedisManager(serverName string, pool *meta.RedisPool) *RedisManager {
	rm := &RedisManager{
		serverName:   serverName,
		pool:         pool,
		errorMetrics: meta.NewErrorMetrics(metrics.CoordinationRedisErrors),
	}

	hb := newHeartbeat(rm)
	hb.start()
	rm.closer = hb
	return rm
}

//GetInstances returns instance names list from Redis
func (rm *RedisManager) GetInstances() ([]string, error) {
	connection := rm.pool.Get()
	defer connection.Close()

	instancesMap, err := redis.StringMap(connection.Do("HGETALL", heartbeatKey))
	if err != nil && err != redis.ErrNil {
		rm.errorMetrics.NoticeError(err)
		return nil, err
	}

	instances := []string{}
	for instance, lastHeartbeatTime := range instancesMap {
		t, err := time.Parse(time.RFC3339Nano, lastHeartbeatTime)
		if err != nil {
			logging.SystemErrorf("error parsing instance [%s] heartbeat time [%s] string into time: %v", instance, lastHeartbeatTime, err)
			continue
		}

		//account only instances with last heartbeat less than 2 minutes ago
		if timestamp.Now().UTC().Sub(t).Seconds() <= 120 {
			instances = append(instances, instance)
		}
	}

	return instances, nil
}

//heartbeat writes timestamp with server name under key
//Instances are considered alive if timestamp < now minus 120 seconds
func (rm *RedisManager) heartbeat() error {
	field := rm.serverName
	connection := rm.pool.Get()
	defer connection.Close()

	_, err := connection.Do("HSET", heartbeatKey, field, timestamp.NowUTC())
	if err != nil && err != redis.ErrNil {
		rm.errorMetrics.NoticeError(err)
		return err
	}

	return nil
}

func (rm *RedisManager) Close() error {
	return rm.closer.Close()
}
