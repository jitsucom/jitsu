package storages

import (
	"encoding/json"
	"fmt"
	"github.com/gomodule/redigo/redis"
	entime "github.com/jitsucom/jitsu/configurator/time"
	"github.com/jitsucom/jitsu/server/logging"
	"github.com/jitsucom/jitsu/server/meta"
	"time"
)

const lastUpdatedPerCollection = "configs#meta#last_updated"

type Redis struct {
	pool *redis.Pool
}

func NewRedis(host string, port int, password string) (*Redis, error) {
	logging.Infof("Initializing redis configuration storage [%s:%d]...", host, port)

	pool, err := meta.NewRedisPool(host, port, password)
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

func (r *Redis) GetAllGroupedByID(collection string) ([]byte, error) {
	connection := r.pool.Get()
	defer connection.Close()

	configsByID, err := redis.StringMap(connection.Do("hgetall", toRedisKey(collection)))
	if err != nil {
		return nil, err
	}
	configs := make(map[string]interface{})
	for id, stringConfig := range configsByID {
		config := map[string]interface{}{}
		err := json.Unmarshal([]byte(stringConfig), &config)
		if err != nil {
			logging.Errorf("Failed to parse collection %s, id=[%s], %v", collection, id, err)
			return nil, err
		}
		configs[id] = config
	}
	return json.Marshal(configs)
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

func (r *Redis) Store(collection string, key string, entity interface{}) error {
	connection := r.pool.Get()
	defer connection.Close()
	configuration, err := toStringMap(entity)
	if err != nil {
		return fmt.Errorf("Error converting configuration %s, id=[%s]: %v", collection, key, err)
	}
	lastUpdatedTimestamp := entime.AsISOString(time.Now().UTC())

	serialized, err := json.MarshalIndent(configuration, "", "    ")
	if err != nil {
		logging.Errorf("Error serializing entity to store to [%s], id=[%s]: %v", collection, key, err)
		return fmt.Errorf("Error storing collection [%s], id=[%s]: %v", collection, key, err)
	}
	_, err = connection.Do("hset", toRedisKey(collection), key, string(serialized))
	if err != nil {
		return err
	}
	_, err = connection.Do("hset", lastUpdatedPerCollection, collection, lastUpdatedTimestamp)
	if err != nil {
		return fmt.Errorf("Error while updating configs#meta#last_updated collection for [%s]: %v", collection, err)
	}
	return nil
}

func toStringMap(value interface{}) (map[string]interface{}, error) {
	marshal, err := json.Marshal(value)
	if err != nil {
		return nil, err
	}
	config := make(map[string]interface{})
	err = json.Unmarshal(marshal, &config)
	return config, err

}

func toRedisKey(collection string) string {
	return "config#" + collection
}

func (r *Redis) Close() error {
	return r.pool.Close()
}
