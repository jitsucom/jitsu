package drivers

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"github.com/gomodule/redigo/redis"
	"github.com/jitsucom/jitsu/server/logging"
	"github.com/jitsucom/jitsu/server/meta"
	"time"
)

const (
	idField        = "__id"
	HashCollection = "hash"
)

type RedisConfig struct {
	Host     string      `mapstructure:"host" json:"host,omitempty" yaml:"host,omitempty"`
	Port     json.Number `mapstructure:"port" json:"port,omitempty" yaml:"port,omitempty"`
	Password string      `mapstructure:"password" json:"password,omitempty" yaml:"password,omitempty"`
}

func (rc *RedisConfig) Validate() error {
	if rc == nil {
		return errors.New("Redis config is required")
	}
	if rc.Host == "" {
		return errors.New("host is not set")
	}
	return nil
}

type Redis struct {
	collection     *Collection
	connectionPool *redis.Pool
}

func init() {
	if err := RegisterDriver(RedisType, NewRedis); err != nil {
		logging.Errorf("Failed to register driver %s: %v", RedisType, err)
	}
}

func NewRedis(ctx context.Context, sourceConfig *SourceConfig, collection *Collection) (Driver, error) {
	config := &RedisConfig{}
	err := unmarshalConfig(sourceConfig.Config, config)
	if err != nil {
		return nil, err
	}
	if collection.Type != HashCollection {
		return nil, fmt.Errorf("Only [%s] collection type is supported now", HashCollection)
	}

	if config.Port.String() == "" {
		config.Port = "6379"
		logging.Warnf("[%s] port wasn't provided. Will be used default one: %s", sourceConfig.SourceID, config.Port.String())
	}

	intPort, err := config.Port.Int64()
	if err != nil {
		return nil, fmt.Errorf("Error casting redis port [%s] to int: %v", config.Port.String(), err)
	}

	return &Redis{collection: collection,
		connectionPool: meta.NewRedisPool(config.Host, int(intPort), config.Password)}, nil
}

func (r *Redis) GetAllAvailableIntervals() ([]*TimeInterval, error) {
	return []*TimeInterval{NewTimeInterval(ALL, time.Time{})}, nil
}

func (r *Redis) GetObjectsFor(interval *TimeInterval) ([]map[string]interface{}, error) {
	connection := r.connectionPool.Get()
	defer connection.Close()

	configsByID, err := redis.StringMap(connection.Do("hgetall", r.collection.Name))
	if err != nil {
		return nil, err
	}
	var configs []map[string]interface{}
	for id, stringConfig := range configsByID {
		config := map[string]interface{}{}
		err := json.Unmarshal([]byte(stringConfig), &config)
		if err != nil {
			logging.Errorf("Failed to parse collection %s, id=[%s], %v", r.collection.Name, id, err)
			return nil, err
		}
		config[idField] = id
		configs = append(configs, config)
	}
	return configs, nil
}

func (r *Redis) TestConnection() error {
	//test connection
	connection := r.connectionPool.Get()
	defer connection.Close()

	_, err := redis.String(connection.Do("PING"))
	if err != nil {
		return err
	}

	return nil
}

func (r *Redis) Type() string {
	return RedisType
}

func (r *Redis) GetCollectionTable() string {
	return r.collection.GetTableName()
}

func (r *Redis) Close() error {
	return r.connectionPool.Close()
}
