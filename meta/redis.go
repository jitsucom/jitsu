package meta

import (
	"fmt"
	"github.com/gomodule/redigo/redis"
	"github.com/jitsucom/eventnative/logging"
	"github.com/jitsucom/eventnative/metrics"
	"strconv"
	"strings"
	"time"
)

type Redis struct {
	pool *redis.Pool
}

//redis key [variables] - description
//source#sourceId:collection#collectionId:chunks [sourceId, collectionId] - hashtable with signatures
//source#sourceId:collection#collectionId:status [sourceId, collectionId] - hashtable with collection statuses
//source#sourceId:collection#collectionId:log [sourceId, collectionId] - hashtable with reloading logs

func NewRedis(host string, port int, password string) (*Redis, error) {
	r := &Redis{pool: &redis.Pool{
		MaxIdle:     100,
		MaxActive:   600,
		IdleTimeout: 240 * time.Second,

		Wait: false,
		Dial: func() (redis.Conn, error) {
			c, err := redis.Dial(
				"tcp",
				host+":"+strconv.Itoa(port),
				redis.DialConnectTimeout(10*time.Second),
				redis.DialReadTimeout(10*time.Second),
				redis.DialPassword(password),
			)
			if err != nil {
				return nil, err
			}
			return c, err
		},
		TestOnBorrow: func(c redis.Conn, t time.Time) error {
			_, err := c.Do("PING")
			return err
		},
	}}

	//test connection
	connection := r.pool.Get()
	defer connection.Close()
	_, err := redis.String(connection.Do("PING"))
	if err != nil {
		return nil, fmt.Errorf("Error testing connection to Redis: %v", err)
	}

	return r, nil
}

func (r *Redis) GetSignature(sourceId, collection, interval string) (string, error) {
	key := "source#" + sourceId + ":collection#" + collection + ":chunks"
	field := interval
	connection := r.pool.Get()
	defer connection.Close()
	signature, err := redis.String(connection.Do("HGET", key, field))
	noticeError(err)
	if err != nil {
		if err == redis.ErrNil {
			return "", nil
		}

		return "", err
	}

	return signature, nil
}

func (r *Redis) SaveSignature(sourceId, collection, interval, signature string) error {
	key := "source#" + sourceId + ":collection#" + collection + ":chunks"
	field := interval
	connection := r.pool.Get()
	defer connection.Close()
	_, err := connection.Do("HSET", key, field, signature)
	noticeError(err)
	if err != redis.ErrNil {
		return err
	}

	return nil
}

func (r *Redis) GetCollectionStatus(sourceId, collection string) (string, error) {
	key := "source#" + sourceId + ":collection#" + collection + ":status"
	field := "current"
	connection := r.pool.Get()
	defer connection.Close()
	status, err := redis.String(connection.Do("HGET", key, field))
	noticeError(err)
	if err != nil {
		if err == redis.ErrNil {
			return "", nil
		}

		return "", err
	}

	return status, nil
}

func (r *Redis) SaveCollectionStatus(sourceId, collection, status string) error {
	key := "source#" + sourceId + ":collection#" + collection + ":status"
	field := "current"
	connection := r.pool.Get()
	defer connection.Close()
	_, err := connection.Do("HSET", key, field, status)
	noticeError(err)
	if err != redis.ErrNil {
		return err
	}

	return nil
}

func (r *Redis) GetCollectionLog(sourceId, collection string) (string, error) {
	key := "source#" + sourceId + ":collection#" + collection + ":log"
	field := "current"
	connection := r.pool.Get()
	defer connection.Close()
	log, err := redis.String(connection.Do("HGET", key, field))
	noticeError(err)
	if err != nil {
		if err == redis.ErrNil {
			return "", nil
		}

		return "", err
	}

	return log, nil
}

func (r *Redis) SaveCollectionLog(sourceId, collection, log string) error {
	key := "source#" + sourceId + ":collection#" + collection + ":log"
	field := "current"
	connection := r.pool.Get()
	defer connection.Close()
	_, err := connection.Do("HSET", key, field, log)
	noticeError(err)
	if err != redis.ErrNil {
		return err
	}

	return nil
}

func (r *Redis) Type() string {
	return RedisType
}

func (r *Redis) Close() error {
	return r.pool.Close()
}

func noticeError(err error) {
	if err != nil {
		if err == redis.ErrPoolExhausted {
			metrics.RedisErrors("ERR_POOL_EXHAUSTED")
		} else if err == redis.ErrNil {
			metrics.RedisErrors("ERR_NIL")
		} else if strings.Contains(strings.ToLower(err.Error()), "timeout") {
			metrics.RedisErrors("ERR_TIMEOUT")
		} else {
			metrics.RedisErrors("UNKNOWN")
			logging.Error("Unknown redis error:", err)
		}
	}
}
