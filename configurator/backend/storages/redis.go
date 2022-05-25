package storages

import (
	"fmt"
	"time"

	"github.com/gomodule/redigo/redis"
	"github.com/jitsucom/jitsu/configurator/storages/migration"
	entime "github.com/jitsucom/jitsu/configurator/time"
	"github.com/jitsucom/jitsu/server/logging"
	"github.com/jitsucom/jitsu/server/meta"
	"github.com/pkg/errors"
)

var migrations = []Migration{
	migration.MultiProjectSupport,
}

//TODO change to config#meta someday
const (
	lastUpdatedPerCollection = "configs#meta#last_updated"
	metaKey                  = "meta#storage"
	versionKey               = "version"
)

type Redis struct {
	pool *meta.RedisPool
}

func NewRedis(factory *meta.RedisPoolFactory) (*Redis, error) {
	logging.Infof("Initializing redis configuration storage [%s]...", factory.Details())

	pool, err := factory.Create()
	if err != nil {
		return nil, err
	}

	storage := &Redis{pool: pool}
	if err := storage.migrate(); err != nil {
		pool.Close()
		return nil, errors.Wrap(err, "migrate")
	}

	return storage, nil
}

func (r *Redis) migrate() error {
	conn := r.pool.Get()
	defer conn.Close()

	version, err := redis.Int(conn.Do("HGET", metaKey, versionKey))
	switch err {
	case nil:
	case redis.ErrNil:
		version = 0
	default:
		return errors.Wrap(err, "load db version")
	}

	for i, migration := range migrations {
		if i < version {
			continue
		}

		if err := migration.Run(conn); err != nil {
			return errors.Wrapf(err, "run migration %d", i)
		}

		if _, err := conn.Do("HSET", metaKey, versionKey, i+1); err != nil {
			return errors.Wrap(err, "update db version")
		}

		logging.Infof("Successfully migrated Redis storage to version %d", i+1)
	}

	return nil
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

func (r *Redis) Store(collection string, id string, entity []byte) error {
	connection := r.pool.Get()
	defer connection.Close()

	lastUpdatedTimestamp := entime.AsISOString(time.Now().UTC())

	_, err := connection.Do("hset", toRedisKey(collection), id, string(entity))
	if err != nil {
		return err
	}
	_, err = connection.Do("hset", lastUpdatedPerCollection, collection, lastUpdatedTimestamp)
	if err != nil {
		return fmt.Errorf("Error while updating configs#meta#last_updated collection for [%s]: %v", collection, err)
	}
	return nil
}

func (r *Redis) Delete(collection string, id string) error {
	connection := r.pool.Get()
	defer connection.Close()

	lastUpdatedTimestamp := entime.AsISOString(time.Now().UTC())

	_, err := connection.Do("hdel", toRedisKey(collection), id)
	if err != nil {
		return err
	}
	_, err = connection.Do("hset", lastUpdatedPerCollection, collection, lastUpdatedTimestamp)
	if err != nil {
		return fmt.Errorf("Error while updating configs#meta#last_updated collection for [%s]: %v", collection, err)
	}
	return nil
}

func (r *Redis) AddScored(key string, score int64, entity []byte) error {
	conn := r.pool.Get()
	defer conn.Close()

	_, err := conn.Do("ZADD", key, score, entity)
	return err
}

func (r *Redis) RemoveScored(prefix string, from, to int64) error {
	conn := r.pool.Get()
	defer conn.Close()

	var cursor int
	for {
		if reply, err := redis.Values(conn.Do("SCAN", cursor, "MATCH", prefix+"*")); err != nil {
			return errors.Wrap(err, "scan keys")
		} else if cursor, err = redis.Int(reply[0], nil); err != nil {
			return errors.Wrap(err, "parse cursor value")
		} else if keys, err := redis.Strings(reply[1], nil); err != nil {
			return errors.Wrap(err, "parse values")
		} else {
			for _, value := range keys {
				if _, err := conn.Do("ZREMRANGEBYSCORE", value, from, to); err != nil {
					return errors.Wrap(err, "remove range")
				}
			}
		}

		if cursor == 0 {
			break
		}
	}

	return nil
}

func (r *Redis) GetIDs(collection string) ([]string, error) {
	conn := r.pool.Get()
	defer conn.Close()

	return redis.Strings(conn.Do("HKEYS", toRedisKey(collection)))
}

func (r *Redis) DeleteRelation(relation, id string) error {
	conn := r.pool.Get()
	defer conn.Close()
	_, err := conn.Do("DEL", getRelationKey(relation, id))
	return err
}

func (r *Redis) GetRelatedIDs(relation string, id string) ([]string, error) {
	conn := r.pool.Get()
	defer conn.Close()
	return redis.Strings(conn.Do("SMEMBERS", getRelationKey(relation, id)))
}

func (r *Redis) AddRelatedIDs(relation string, id string, relatedIDs ...string) error {
	if len(relatedIDs) == 0 {
		return nil
	}

	conn := r.pool.Get()
	defer conn.Close()
	_, err := conn.Do("SADD", getRelationArgs(relation, id, relatedIDs)...)
	return err
}

func (r *Redis) DeleteRelatedIDs(relation string, id string, relatedIDs ...string) error {
	if len(relatedIDs) == 0 {
		return nil
	}

	conn := r.pool.Get()
	defer conn.Close()
	_, err := conn.Do("SREM", getRelationArgs(relation, id, relatedIDs)...)
	return err
}

func getRelationArgs(relation, id string, relatedIDs []string) []interface{} {
	args := make([]interface{}, len(relatedIDs)+1)
	args[0] = getRelationKey(relation, id)
	for i, relatedID := range relatedIDs {
		args[i+1] = relatedID
	}

	return args
}

func getRelationKey(relation string, id string) string {
	return getRelationKeyPrefix(relation) + id
}

func getRelationKeyPrefix(relation string) string {
	return "relation#" + relation + ":"
}

func toRedisKey(collection string) string {
	return meta.ConfigPrefix + collection
}

func (r *Redis) Close() error {
	return r.pool.Close()
}
