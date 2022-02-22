package users

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
	SaveAnonymousEvent(tokenID, anonymousID, eventID, payload string) error
	GetAnonymousEvents(tokenID, anonymousID string) (map[string]string, error)
	DeleteAnonymousEvent(tokenID, anonymousID string, eventID ...string) error
	Type() string
}

type Dummy struct{}

func (d *Dummy) SaveAnonymousEvent(tokenID, anonymousID, eventID, payload string) error {
	return nil
}
func (d *Dummy) GetAnonymousEvents(tokenID, anonymousID string) (map[string]string, error) {
	return map[string]string{}, nil
}
func (d *Dummy) DeleteAnonymousEvent(tokenID, anonymousID string, eventID ...string) error {
	return nil
}
func (d *Dummy) Type() string { return DummyStorageType }
func (d *Dummy) Close() error { return nil }

//InitializeStorage returns configured users.Storage (redis or dummy)
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
	if viper.GetString("users_recognition.redis.host") != "" {
		redisConfigurationSource = viper.Sub("users_recognition.redis")
	}

	if redisConfigurationSource == nil || redisConfigurationSource.GetString("host") == "" {
		return &Dummy{}, nil
	}

	host := redisConfigurationSource.GetString("host")
	port := redisConfigurationSource.GetInt("port")
	password := redisConfigurationSource.GetString("password")
	sentinelMaster := redisConfigurationSource.GetString("sentinel_master_name")
	tlsSkipVerify := redisConfigurationSource.GetBool("tls_skip_verify")
	anonymousEventsMinutesTTL := redisConfigurationSource.GetInt("ttl_minutes.anonymous_events")

	factory := meta.NewRedisPoolFactory(host, port, password, tlsSkipVerify, sentinelMaster)
	options := factory.GetOptions()
	options.MaxActive = 100
	factory.WithOptions(options)
	factory.CheckAndSetDefaultPort()

	if anonymousEventsMinutesTTL > 0 {
		logging.Infof("🕵️ Initializing users recognition redis [%s] with anonymous events ttl: %d...", factory.Details(), anonymousEventsMinutesTTL)
	} else {
		logging.Infof("🕵️ Initializing users recognition redis [%s]...", factory.Details())
	}

	pool, err := factory.Create()
	if err != nil {
		return nil, err
	}

	return NewRedis(pool, anonymousEventsMinutesTTL), nil
}
