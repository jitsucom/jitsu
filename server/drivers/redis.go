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

//RedisConfig is a Redis configuration dto for serialization
type RedisConfig struct {
	Host          string      `mapstructure:"host" json:"host,omitempty" yaml:"host,omitempty"`
	Port          json.Number `mapstructure:"port" json:"port,omitempty" yaml:"port,omitempty"`
	Password      string      `mapstructure:"password" json:"password,omitempty" yaml:"password,omitempty"`
	TLSSkipVerify bool        `mapstructure:"tls_skip_verify" json:"tls_skip_verify,omitempty" yaml:"tls_skip_verify,omitempty"`
}

//Validate returns err if configuration is invalid
func (rc *RedisConfig) Validate() error {
	if rc == nil {
		return errors.New("Redis config is required")
	}
	if rc.Host == "" {
		return errors.New("host is not set")
	}
	return nil
}

//RedisParameters is a Redis key configuration dto for serialization
type RedisParameters struct {
	RedisKey string `mapstructure:"redis_key" json:"redis_key,omitempty" yaml:"redis_key,omitempty"`
}

//Validate returns err if configuration is invalid
func (rp *RedisParameters) Validate() error {
	if rp == nil {
		return errors.New("'parameters' configuration section is required")
	}
	if rp.RedisKey == "" {
		return errors.New("'redis_key' is required")
	}
	return nil
}

//Redis is a Redis driver. It is used in syncing data from Redis. Only HASH keys are supported
type Redis struct {
	collection     *Collection
	connectionPool *redis.Pool
	redisKey       string
}

func init() {
	if err := RegisterDriver(RedisType, NewRedis); err != nil {
		logging.Errorf("Failed to register driver %s: %v", RedisType, err)
	}
}

//NewRedis returns configured Redis driver instance
func NewRedis(ctx context.Context, sourceConfig *SourceConfig, collection *Collection) (Driver, error) {
	config := &RedisConfig{}
	err := UnmarshalConfig(sourceConfig.Config, config)
	if err != nil {
		return nil, err
	}
	if collection.Type != HashCollection {
		return nil, fmt.Errorf("Only [%s] collection type is supported now", HashCollection)
	}

	parameters := &RedisParameters{}
	if err := UnmarshalConfig(collection.Parameters, parameters); err != nil {
		return nil, err
	}
	if err := parameters.Validate(); err != nil {
		return nil, err
	}

	intPort, err := config.Port.Int64()
	if err != nil {
		return nil, fmt.Errorf("Error casting redis port [%s] to int: %v", config.Port.String(), err)
	}

	redisConfig := &meta.RedisConfiguration{
		Host:          config.Host,
		Port:          int(intPort),
		Password:      config.Password,
		TLSSkipVerify: config.TLSSkipVerify,
	}

	if redisConfig.Port == 0 && !redisConfig.IsURL() && !redisConfig.IsSecuredURL() {
		redisConfig.Port = 6379
		logging.Warnf("[%s] port wasn't provided. Will be used default one: %d", sourceConfig.SourceID, redisConfig.Port)
	}

	pool, err := meta.NewRedisPool(redisConfig)
	if err != nil {
		return nil, err
	}

	return &Redis{
		collection:     collection,
		connectionPool: pool,
		redisKey:       parameters.RedisKey,
	}, nil
}

func (r *Redis) GetAllAvailableIntervals() ([]*TimeInterval, error) {
	return []*TimeInterval{NewTimeInterval(ALL, time.Time{})}, nil
}

func (r *Redis) GetObjectsFor(interval *TimeInterval) ([]map[string]interface{}, error) {
	connection := r.connectionPool.Get()
	defer connection.Close()

	configsByID, err := redis.StringMap(connection.Do("hgetall", r.redisKey))
	if err != nil {
		return nil, err
	}
	var configs []map[string]interface{}
	for id, stringConfig := range configsByID {
		config := map[string]interface{}{}
		err := json.Unmarshal([]byte(stringConfig), &config)
		if err != nil {
			logging.Errorf("Failed to parse collection %s, id=[%s], %v", r.redisKey, id, err)
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

func (r *Redis) GetCollectionMetaKey() string {
	return r.collection.Name + "_" + r.GetCollectionTable()
}

func (r *Redis) Close() error {
	return r.connectionPool.Close()
}
