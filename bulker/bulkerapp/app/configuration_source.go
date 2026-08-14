package app

import (
	"fmt"
	"github.com/hjson/hjson-go/v4"
	bulker "github.com/jitsucom/bulker/bulkerlib"
	"github.com/jitsucom/bulker/jitsubase/appbase"
	"github.com/jitsucom/bulker/jitsubase/logging"
	"github.com/mitchellh/mapstructure"
	"github.com/spf13/viper"
	"gopkg.in/yaml.v3"
	"io"
	"os"
	"strings"
	"time"
)

const destinationsKey = "destinations"
const defaultEnvDestinationPrefix = "DESTINATION"

type DestinationConfig struct {
	UpdatedAt           time.Time `mapstructure:"updatedAt" json:"updatedAt"`
	UsesBulker          bool      `mapstructure:"usesBulker" json:"usesBulker"`
	WorkspaceId         string    `mapstructure:"workspaceId" json:"workspaceId"`
	bulker.Config       `mapstructure:",squash"`
	bulker.StreamConfig `mapstructure:",squash"`
	Special             string `mapstructure:"special" json:"special"`
}

func (dc *DestinationConfig) Id() string {
	return dc.Config.Id
}

type ConfigurationSource interface {
	io.Closer
	GetDestinationConfigs() []*DestinationConfig
	GetDestinationConfig(id string) *DestinationConfig
	ChangesChannel() <-chan bool
	//Equals(other ConfigurationSource) bool
}

func InitConfigurationSource(config *Config) (ConfigurationSource, error) {
	envPrefix := config.AppSetting.EnvPrefixWithUnderscore()
	cfgSource := config.ConfigSource
	if cfgSource == "" {
		logging.Infof("%sCONFIG_SOURCE is not set. Using environment variables configuration source with prefix: %s%s", envPrefix, envPrefix, defaultEnvDestinationPrefix)
		return NewEnvConfigurationSource(envPrefix, defaultEnvDestinationPrefix), nil
	} else if cfgSource == "redis" {
		config.ConfigSource = config.RedisURL
		cfgSource = config.RedisURL
	}

	var configurationSource ConfigurationSource
	if strings.HasPrefix(cfgSource, "file://") || !strings.Contains(cfgSource, "://") {
		filePath := strings.TrimPrefix(cfgSource, "file://")
		yamlConfig, err := os.ReadFile(filePath)
		if err != nil {
			return nil, fmt.Errorf("❗️error reading yaml config file: %s: %v", filePath, err)
		}
		configurationSource, err = NewYamlConfigurationSource(yamlConfig)
		if err != nil {
			return nil, fmt.Errorf("❗error creating yaml configuration source from config file: %s: %v", filePath, err)
		}
	} else if strings.HasPrefix(cfgSource, "http://") || strings.HasPrefix(cfgSource, "https://") {
		var err error
		configurationSource = NewHTTPConfigurationSource(config)
		if err != nil {
			return nil, fmt.Errorf("❗️error while init postgres configuration source: %s: %v", cfgSource, err)
		}
	} else if strings.HasPrefix(cfgSource, "postgres") {
		var err error
		configurationSource, err = NewPostgresConfigurationSource(config)
		if err != nil {
			return nil, fmt.Errorf("❗️error while init postgres configuration source: %s: %v", cfgSource, err)
		}
	} else if strings.HasPrefix(cfgSource, "redis://") || strings.HasPrefix(cfgSource, "rediss://") {
		var err error
		configurationSource, err = NewRedisConfigurationSource(config)
		if err != nil {
			return nil, fmt.Errorf("❗️error while init redis configuration source: %s: %v", cfgSource, err)
		}
	} else if strings.HasPrefix(cfgSource, "env://") {
		if !strings.HasPrefix(cfgSource, "env://"+envPrefix) {
			return nil, fmt.Errorf("❗environement variable for configuration source must start with application prefix: %s got: %s", envPrefix, strings.TrimPrefix(cfgSource, "env://"))
		}
		dstPrefix := strings.TrimPrefix(cfgSource, "env://"+envPrefix)
		configurationSource = NewEnvConfigurationSource(envPrefix, dstPrefix)
	} else {
		return nil, fmt.Errorf("❗unsupported configuration source: %s", cfgSource)
	}

	internalDestinationsSource := NewEnvConfigurationSource(envPrefix, "INTERNAL")
	return NewMultiConfigurationSource([]ConfigurationSource{internalDestinationsSource, configurationSource}), nil
}

type YamlConfigurationSource struct {
	appbase.Service

	changesChan chan bool

	config       map[string]any
	destinations map[string]*DestinationConfig
}

func NewYamlConfigurationSource(data []byte) (*YamlConfigurationSource, error) {
	base := appbase.NewServiceBase("yaml_configuration")
	cfg := make(map[string]any)
	err := yaml.Unmarshal(data, cfg)
	if err != nil {
		return nil, err
	}
	y := &YamlConfigurationSource{
		Service:     base,
		changesChan: make(chan bool),
		config:      cfg,
	}
	err = y.init()
	if err != nil {
		return nil, err
	}
	return y, nil
}

func (ycp *YamlConfigurationSource) init() error {
	destinationsRaw, ok := ycp.config[destinationsKey]
	if !ok {
		return nil
	}
	destinations, ok := destinationsRaw.(map[string]any)
	if !ok {
		return ycp.NewError("failed to parse destinations. Expected map[string]any got: %T", destinationsRaw)
	}
	results := make(map[string]*DestinationConfig, len(destinations))
	for id, destination := range destinations {
		cfg := &DestinationConfig{}
		err := mapstructure.Decode(destination, cfg)
		if err != nil {
			ycp.Errorf("Failed to parse destination config %s: %v:\n%s", id, err, destination)
			continue
		}
		cfg.Config.Id = id
		//logging.Infof("Parsed destination config: %+v", cfg)
		results[id] = cfg
	}
	ycp.destinations = results
	return nil
}

func (ycp *YamlConfigurationSource) GetDestinationConfigs() []*DestinationConfig {
	results := make([]*DestinationConfig, len(ycp.destinations))
	i := 0
	for _, destination := range ycp.destinations {
		results[i] = destination
		i++
	}
	return results
}

func (ycp *YamlConfigurationSource) GetDestinationConfig(id string) *DestinationConfig {
	return ycp.destinations[id]
}

func (ycp *YamlConfigurationSource) GetValue(key string) any {
	return ycp.config[key]
}

//func (ycp *YamlConfigurationSource) Equals(other ConfigurationSource) bool {
//	o, ok := other.(*YamlConfigurationSource)
//	if !ok {
//		return false
//	}
//	return reflect.DeepEqual(ycp.config, o.config)
//}

func (ycp *YamlConfigurationSource) ChangesChannel() <-chan bool {
	return ycp.changesChan
}

func (ycp *YamlConfigurationSource) Close() error {
	close(ycp.changesChan)
	return nil
}

type EnvConfigurationSource struct {
	appbase.Service

	changesChan chan bool

	destinations map[string]*DestinationConfig
}

func NewEnvConfigurationSource(envPrefix, prefix string) *EnvConfigurationSource {
	base := appbase.NewServiceBase("env_configuration")
	results := make(map[string]*DestinationConfig)
	// look for all envs starting with prefix
	envs := os.Environ()
	for _, env := range envs {
		parts := strings.SplitN(env, "=", 2)
		if len(parts) != 2 {
			continue
		}
		id := parts[0]
		if !strings.HasPrefix(id, envPrefix+prefix) {
			continue
		}
		id = strings.TrimPrefix(id, envPrefix+prefix+"_")
		value := parts[1]
		cfg := &DestinationConfig{}
		err := hjson.Unmarshal([]byte(value), &cfg)
		if err != nil {
			base.Errorf("Failed to parse destination config %s: %v:\n%s", id, err, value)
			continue
		}
		if len(cfg.Config.Id) > 0 {
			id = cfg.Config.Id
		}
		cfg.Config.Id = id
		base.Debugf("parsed config for destination %s: %+v", id, cfg)
		results[id] = cfg
	}
	// look for all viper keys starting with prefix
	prefix = strings.ToLower(prefix)
	for _, env := range viper.GetViper().AllKeys() {
		if !strings.HasPrefix(env, prefix) {
			continue
		}
		id := strings.TrimPrefix(env, prefix+"_")
		value := viper.GetString(env)
		cfg := &DestinationConfig{}
		err := hjson.Unmarshal([]byte(value), &cfg)
		if err != nil {
			base.Errorf("Failed to parse destination config %s: %v:\n%s", id, err, value)
			continue
		}
		if len(cfg.Config.Id) > 0 {
			id = cfg.Config.Id
		}
		base.Debugf("parsed config for destination %s: %+v", id, cfg)
		results[id] = cfg
	}
	y := &EnvConfigurationSource{
		Service:      base,
		changesChan:  make(chan bool),
		destinations: results,
	}
	return y
}

func (ecs *EnvConfigurationSource) GetDestinationConfigs() []*DestinationConfig {
	results := make([]*DestinationConfig, len(ecs.destinations))
	i := 0
	for _, destination := range ecs.destinations {
		results[i] = destination
		i++
	}
	return results
}

func (ecs *EnvConfigurationSource) GetDestinationConfig(id string) *DestinationConfig {
	return ecs.destinations[id]
}

func (ecs *EnvConfigurationSource) GetValue(key string) any {
	return nil
}

func (ecs *EnvConfigurationSource) ChangesChannel() <-chan bool {
	return ecs.changesChan
}

func (ecs *EnvConfigurationSource) Close() error {
	close(ecs.changesChan)
	return nil
}
