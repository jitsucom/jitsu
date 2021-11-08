package storages

import (
	"context"
	"errors"
	"github.com/jitsucom/jitsu/server/logging"
	"github.com/jitsucom/jitsu/server/meta"
	"github.com/spf13/viper"
	"time"
)

var ErrConfigurationNotFound = errors.New("Configuration wasn't found")

//ConfigurationsStorage - Collection here is used as a type of configuration - like destinations, api_keys, custom_domains, etc.
type ConfigurationsStorage interface {
	//Get returns a single configuration from collection
	//If configuration is not found, must return ErrConfigurationNotFound for correct response message
	Get(collection string, id string) ([]byte, error)
	//GetAllGroupedByID returns all the configurations of requested type grouped by id (result must be
	//deserializable to map[string]<entity_type>
	GetAllGroupedByID(collection string) ([]byte, error)
	//GetCollectionLastUpdated returns time when collection was last updated
	//(max _lastUpdated field among entities)
	GetCollectionLastUpdated(collection string) (*time.Time, error)
	//UpdateCollectionLastUpdated updates time when collection was last updated
	UpdateCollectionLastUpdated(collection string) error
	//Store saves entity and also must update _lastUpdated field of the collection
	Store(collection string, id string, entity interface{}) error
	//Close frees all the resources used by the storage (close connections etc.)
	Close() error
}

func NewConfigurationsStorage(ctx context.Context, vp *viper.Viper) (ConfigurationsStorage, error) {
	if vp.IsSet("storage.firebase.project_id") {
		projectID := vp.GetString("storage.firebase.project_id")
		credentialsFile := vp.GetString("storage.firebase.credentials_file")
		return NewFirebase(ctx, projectID, credentialsFile)
	} else if vp.IsSet("storage.redis.host") {
		host := vp.GetString("storage.redis.host")
		if host == "" {
			return nil, errors.New("storage.redis.host must not be empty")
		}

		port := vp.GetInt("storage.redis.port")
		password := vp.GetString("storage.redis.password")
		tlsSkipVerify := vp.GetBool("storage.redis.tls_skip_verify")
		sentinelMaster := vp.GetString("storage.redis.sentinel_master_name")

		redisConfig := meta.NewRedisPoolFactory(host, port, password, tlsSkipVerify, sentinelMaster)
		if defaultPort, ok := redisConfig.CheckAndSetDefaultPort(); ok {
			logging.Infof("storage.redis.port isn't configured. Will be used default: %d", defaultPort)
		}

		return NewRedis(redisConfig)
	} else {
		return nil, errors.New("Unknown 'storage' section type. Supported: firebase, redis")
	}
}
