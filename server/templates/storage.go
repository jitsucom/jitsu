package templates

import (
	"github.com/jitsucom/jitsu/server/logging"
	"github.com/jitsucom/jitsu/server/meta"
	"github.com/spf13/viper"
	"io"
)

const (
	DummyStorageType = "dummy"
	RedisStorageType = "redis"
)

type Storage interface {
	io.Closer
	//** Transformation Key Value **
	GetTransformValue(destinationId string, key string) (*string, error)
	SetTransformValue(destinationId, key, value string, ttlSec *int64) error
	DeleteTransformValue(destinationId, key string) error
	Type() string
}

type Dummy struct{}

func (d *Dummy) GetTransformValue(destinationId string, key string) (*string, error) {
	return nil, nil
}

func (d *Dummy) SetTransformValue(destinationId, key, value string, ttlSec *int64) error {
	return nil
}

func (d *Dummy) DeleteTransformValue(destinationId, key string) error {
	return nil
}

func (d *Dummy) Type() string { return DummyStorageType }
func (d *Dummy) Close() error { return nil }

// InitializeStorage returns configured users.Storage (redis or dummy)
func InitializeStorage(enabled bool, metaStorageConfiguration *viper.Viper) (Storage, error) {
	if !enabled {
		return &Dummy{}, nil
	}

	var redisConfigurationSource *viper.Viper

	if metaStorageConfiguration != nil {
		//redis config from meta.storage section
		redisConfigurationSource = metaStorageConfiguration.Sub("redis")
	}

	//get redis configuration from separated config section if configured
	if viper.GetString("transform.redis.host") != "" {
		redisConfigurationSource = viper.Sub("transform.redis")
	}

	if redisConfigurationSource == nil || redisConfigurationSource.GetString("host") == "" {
		return &Dummy{}, nil
	}

	host := redisConfigurationSource.GetString("host")
	port := redisConfigurationSource.GetInt("port")
	password := redisConfigurationSource.GetString("password")
	database := redisConfigurationSource.GetInt("database")

	sentinelMaster := redisConfigurationSource.GetString("sentinel_master_name")
	tlsSkipVerify := redisConfigurationSource.GetBool("tls_skip_verify")
	defaultTransformKeyValueTTLms := int64(60 * 24 * 60 * 60 * 1000) //default 60 days
	if redisConfigurationSource.Get("ttl_sec") != nil {
		defaultTransformKeyValueTTLms = redisConfigurationSource.GetInt64("ttl_sec") * 1000
	}

	factory := meta.NewRedisPoolFactory(host, port, password, database, tlsSkipVerify, sentinelMaster)
	options := factory.GetOptions()
	options.MaxActive = 100
	factory.WithOptions(options)
	factory.CheckAndSetDefaultPort()

	if defaultTransformKeyValueTTLms > 0 {
		logging.Infof("🤖️ Initializing transform redis [%s] with default key value ttl ms: %d...", factory.Details(), defaultTransformKeyValueTTLms)
	} else {
		logging.Infof("🤖️ Initializing transform redis [%s]...", factory.Details())
	}

	pool, err := factory.Create()
	if err != nil {
		return nil, err
	}

	return NewRedis(pool, defaultTransformKeyValueTTLms), nil
}
