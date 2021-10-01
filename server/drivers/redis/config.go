package redis

import (
	"encoding/json"
	"errors"
	"github.com/jitsucom/jitsu/server/logging"
	"strings"
)

//RedisConfig is a Redis configuration dto for serialization
type RedisConfig struct {
	Host               string      `mapstructure:"host" json:"host,omitempty" yaml:"host,omitempty"`
	Port               json.Number `mapstructure:"port" json:"port,omitempty" yaml:"port,omitempty"`
	Password           string      `mapstructure:"password" json:"password,omitempty" yaml:"password,omitempty"`
	SentinelMasterName string      `mapstructure:"sentinel_master_name" json:"sentinel_master_name,omitempty" yaml:"sentinel_master_name,omitempty"`
	TLSSkipVerify      bool        `mapstructure:"tls_skip_verify" json:"tls_skip_verify,omitempty" yaml:"tls_skip_verify,omitempty"`
}

//Validate returns err if configuration is invalid
func (rc *RedisConfig) Validate() error {
	if rc == nil {
		return errors.New("Redis config is required")
	}
	if rc.Host == "" {
		return errors.New("host is not set")
	}
	if rc.SentinelMasterName != "" {
		logging.Infof("redis sentinel master name is: %s", rc.SentinelMasterName)
		i, err := rc.Port.Int64()
		if i == 0  || err != nil{
			return errors.New("redis sentinel port is required")
		}
		if strings.HasPrefix(rc.SentinelMasterName, "redis") {
			return errors.New("redis sentinel host should be of the form subdomain.domain,  eg: localhost, stg-redis-headless.redis.svc.cluster.local . no redis:// or rediss:// prefix")
		}
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
