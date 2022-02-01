package storages

import (
	"fmt"
	"github.com/gomodule/redigo/redis"
	entime "github.com/jitsucom/jitsu/configurator/time"
	"github.com/jitsucom/jitsu/server/logging"
	"github.com/jitsucom/jitsu/server/meta"
	"time"
)

//TODO change to config#meta someday
const lastUpdatedPerCollection = "configs#meta#last_updated"

type Redis struct {
	pool *meta.RedisPool
}

func NewRedis(factory *meta.RedisPoolFactory) (*Redis, error) {
	logging.Infof("Initializing redis configuration storage [%s]...", factory.Details())

	pool, err := factory.Create()
	if err != nil {
		return nil, err
	}

	return &Redis{pool: pool}, nil
}

func (r *Redis) Get(collection string, documentID string) ([]byte, error) {
	connection := r.pool.Get()
	defer connection.Close()
	data, err := connection.Do("hget", toRedisKey(collection), documentID)
	if err != nil {
		if err == redis.ErrNil {
			return nil, ErrConfigurationNotFound
		}

		return nil, err
	}
	if data == nil {
		return nil, ErrConfigurationNotFound
	}
	b, ok := data.([]byte)
	if !ok {
		logging.Errorf("Failed to convert Redis response to bytes for collection [%s], id=[%s], value: [%s]", collection, documentID, data)
		return nil, fmt.Errorf("Error getting collection [%s], id=[%s] from configs storage", collection, documentID)
	}
	return b, nil
}

func (r *Redis) GetAllGroupedByID(collection string) (map[string][]byte, error) {
	connection := r.pool.Get()
	defer connection.Close()

	configsByID, err := redis.StringMap(connection.Do("hgetall", toRedisKey(collection)))
	if err != nil {
		return nil, err
	}
	configs := make(map[string][]byte)

	for id, stringConfig := range configsByID {
		configs[id] = []byte(stringConfig)
	}
	return configs, nil
}

func (r *Redis) GetCollectionLastUpdated(collection string) (*time.Time, error) {
	connection := r.pool.Get()
	defer connection.Close()
	lastUpdated, err := redis.String(connection.Do("hget", lastUpdatedPerCollection, collection))
	if err != nil {
		if err == redis.ErrNil {
			return &time.Time{}, nil
		}

		return nil, err
	}

	if lastUpdated == "" {
		return nil, fmt.Errorf("Empty [%s] _lastUpdated", collection)
	}

	t, err := time.Parse(LastUpdatedLayout, lastUpdated)
	if err != nil {
		return nil, fmt.Errorf("Error converting [%s] to time: %v", lastUpdated, err)
	}
	return &t, nil
}

func (r *Redis) UpdateCollectionLastUpdated(collection string) error {
	connection := r.pool.Get()
	defer connection.Close()

	lastUpdatedTimestamp := entime.AsISOString(time.Now().UTC())

	if _, err := connection.Do("hset", lastUpdatedPerCollection, collection, lastUpdatedTimestamp); err != nil {
		return fmt.Errorf("Error while updating last_updated collection for [%s]: %v", collection, err)
	}

	return nil
}

func (r *Redis) Store(collection string, key string, entity []byte) error {
	connection := r.pool.Get()
	defer connection.Close()

	lastUpdatedTimestamp := entime.AsISOString(time.Now().UTC())

	_, err := connection.Do("hset", toRedisKey(collection), key, string(entity))
	if err != nil {
		return err
	}
	_, err = connection.Do("hset", lastUpdatedPerCollection, collection, lastUpdatedTimestamp)
	if err != nil {
		return fmt.Errorf("Error while updating configs#meta#last_updated collection for [%s]: %v", collection, err)
	}
	return nil
}

func toRedisKey(collection string) string {
	return meta.ConfigPrefix + collection
}

func (r *Redis) Close() error {
	return r.pool.Close()
}
