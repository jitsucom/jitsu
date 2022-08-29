package script

import (
	"fmt"
	"github.com/gomodule/redigo/redis"
	"github.com/jitsucom/jitsu/server/meta"
	"github.com/jitsucom/jitsu/server/metrics"
)

//** Retroactive user recognition **
//anonymous_events:token_id#${tokenID}:anonymous_id#${cookies_anonymous_id} [event_id] {event JSON} - hashtable with all anonymous events

type Redis struct {
	pool                 *meta.RedisPool
	keyvalueDefaultTTLms int64
	errorMetrics         *meta.ErrorMetrics
}

func NewRedis(pool *meta.RedisPool, keyvalueDefaultTTLMs int64) *Redis {
	return &Redis{
		pool:                 pool,
		keyvalueDefaultTTLms: keyvalueDefaultTTLMs,
		errorMetrics:         meta.NewErrorMetrics(metrics.TransformKeyValueRedisErrors),
	}
}
func (r *Redis) GetTransformValue(destinationId string, key string) (*string, error) {
	conn := r.pool.Get()
	defer conn.Close()
	metrics.TransformKeyValueGet(destinationId)

	kvKey := getTransformValueKey(destinationId, key)
	value, err := redis.String(conn.Do("GET", kvKey))
	if err != nil {
		if err != redis.ErrNil {
			r.errorMetrics.NoticeError(err)
			return nil, err
		} else {
			return nil, nil
		}
	}
	return &value, nil
}

func (r *Redis) SetTransformValue(destinationId, key, value string, ttlMs *int64) error {
	conn := r.pool.Get()
	defer conn.Close()
	metrics.TransformKeyValueSet(destinationId, len(value))

	kvKey := getTransformValueKey(destinationId, key)
	args := []interface{}{kvKey, value}
	ttl := r.keyvalueDefaultTTLms
	if ttlMs != nil {
		ttl = *ttlMs
	}
	if ttl > 0 {
		args = append(args, "PX", ttl)
	}
	_, err := conn.Do("SET", args...)
	if err != nil && err != redis.ErrNil {
		r.errorMetrics.NoticeError(err)
		return err
	}

	return nil
}

func (r *Redis) DeleteTransformValue(destinationId, key string) error {
	conn := r.pool.Get()
	defer conn.Close()
	metrics.TransformKeyValueDel(destinationId)

	kvKey := getTransformValueKey(destinationId, key)
	_, err := conn.Do("DEL", kvKey)
	if err != nil && err != redis.ErrNil {
		r.errorMetrics.NoticeError(err)
		return err
	}
	return nil
}

func getTransformValueKey(destinationId, key string) string {
	return fmt.Sprintf("transform_kv:%s#%s", destinationId, key)
}

func (r *Redis) Type() string {
	return RedisStorageType
}

func (r *Redis) Close() error {
	return r.pool.Close()
}
