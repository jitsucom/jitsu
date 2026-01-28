package main

import (
	"os"

	"github.com/jitsucom/bulker/jitsubase/appbase"
	"github.com/jitsucom/bulker/jitsubase/utils"
	"github.com/jitsucom/bulker/kafkabase"
	"github.com/spf13/viper"
)

type Config struct {
	// # BASE CONFIG - base setting for jitsu apps
	appbase.Config `mapstructure:",squash"`
	// # KAFKA CONFIG - base kafka setting
	kafkabase.KafkaConfig `mapstructure:",squash"`

	// Cache dir for repository data
	CacheDir string `mapstructure:"CACHE_DIR"`

	// # DATABASE CONFIG - PostgreSQL connection for job status tracking
	DatabaseURL string `mapstructure:"DATABASE_URL" default:""`

	// # KUBERNETES CONFIG - settings for K8s job management
	KubernetesClientConfig string `mapstructure:"KUBERNETES_CLIENT_CONFIG" default:"local"`
	KubernetesNamespace    string `mapstructure:"KUBERNETES_NAMESPACE" default:"default"`
	KubernetesContext      string `mapstructure:"KUBERNETES_CONTEXT"`
	KubernetesNodeSelector string `mapstructure:"KUBERNETES_NODE_SELECTOR"`

	K8sMaxParallelWorkers   int    `mapstructure:"K8S_MAX_PARALLEL_WORKERS" default:"10"`
	ReprocessingWorkerImage string `mapstructure:"REPROCESSING_WORKER_IMAGE" default:"jitsucom/reprocessing-worker:latest"`

	WorkerKafkaBootstrapServers string `mapstructure:"REPROCESSING_WORKER_KAFKA_BOOTSTRAP_SERVERS"`

	RepositoryURL       string `mapstructure:"REPOSITORY_URL"`
	RepositoryAuthToken string `mapstructure:"REPOSITORY_AUTH_TOKEN"`

	// # CLICKHOUSE CONFIG - for dead letter reprocessing
	ClickhouseURL      string `mapstructure:"CLICKHOUSE_URL"`
	ClickhouseHost     string `mapstructure:"CLICKHOUSE_HOST"`
	ClickhouseDatabase string `mapstructure:"CLICKHOUSE_DATABASE" default:"newjitsu_metrics"`
	ClickhouseUsername string `mapstructure:"CLICKHOUSE_USERNAME" default:"default"`
	ClickhousePassword string `mapstructure:"CLICKHOUSE_PASSWORD"`
	ClickhouseSSL      bool   `mapstructure:"CLICKHOUSE_SSL" default:"false"`
}

// Implement ClickhouseEnvVars interface
func (c *Config) GetClickhouseURL() string      { return c.ClickhouseURL }
func (c *Config) GetClickhouseHost() string     { return c.ClickhouseHost }
func (c *Config) GetClickhouseUsername() string { return c.ClickhouseUsername }
func (c *Config) GetClickhousePassword() string { return c.ClickhousePassword }
func (c *Config) GetClickhouseDatabase() string { return c.ClickhouseDatabase }
func (c *Config) GetClickhouseSSL() bool        { return c.ClickhouseSSL }

func init() {
	viper.SetDefault("HTTP_PORT", utils.NvlString(os.Getenv("PORT"), "3049"))
}

func (c *Config) PostInit(settings *appbase.AppSettings) error {
	if err := c.Config.PostInit(settings); err != nil {
		return err
	}
	return nil
}
