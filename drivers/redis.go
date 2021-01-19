package drivers

import (
	"context"
	"encoding/json"
	"errors"
	"github.com/gomodule/redigo/redis"
	"github.com/jitsucom/eventnative/logging"
	"github.com/jitsucom/eventnative/meta"
	"time"
)

const (
	idField   = "__id"
	redisType = "redis"
)

type RedisConfig struct {
	Host     string `mapstructure:"host" json:"host,omitempty" yaml:"host,omitempty"`
	Port     int    `mapstructure:"port" json:"port,omitempty" yaml:"port,omitempty"`
	Password string `mapstructure:"password" json:"password,omitempty" yaml:"password,omitempty"`
}

func (rc *RedisConfig) Validate() error {
	if rc == nil {
		return errors.New("Redis config is required")
	}
	if rc.Host == "" {
		return errors.New("host is not set")
	}
	if rc.Port <= 0 {
		return errors.New("port must be positive")
	}
	return nil
}

type Redis struct {
	collection     *Collection
	connectionPool *redis.Pool
}

func init() {
	if err := RegisterDriverConstructor(redisType, NewRedis); err != nil {
		logging.Errorf("Failed to register driver %s: %v", redisType, err)
	}
}

func NewRedis(ctx context.Context, sourceConfig *SourceConfig, collection *Collection) (Driver, error) {
	config := &RedisConfig{}
	err := unmarshalConfig(sourceConfig.Config, config)
	if err != nil {
		return nil, err
	}
	if collection.Type != "hash" {
		return nil, errors.New("Only [hash] collection type is supported now")
	}
	return &Redis{collection: collection,
		connectionPool: meta.NewRedisPool(config.Host, config.Port, config.Password)}, nil
}

func (r *Redis) GetAllAvailableIntervals() ([]*TimeInterval, error) {
	return []*TimeInterval{NewTimeInterval(ALL, time.Time{})}, nil
}

func (r *Redis) GetObjectsFor(interval *TimeInterval) ([]map[string]interface{}, error) {
	connection := r.connectionPool.Get()
	defer connection.Close()

	configsById, err := redis.StringMap(connection.Do("hgetall", r.collection.Name))
	if err != nil {
		return nil, err
	}
	var configs []map[string]interface{}
	for id, stringConfig := range configsById {
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

func (r *Redis) Type() string {
	return redisType
}

func (r *Redis) GetCollectionTable() string {
	return r.collection.GetTableName()
}

func (r *Redis) Close() error {
	return r.connectionPool.Close()
}
