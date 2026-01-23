package main

import (
	"fmt"
	"os"

	"github.com/jitsucom/bulker/eventslog"
	"github.com/jitsucom/bulker/jitsubase/appbase"
	"github.com/jitsucom/bulker/jitsubase/utils"
	"github.com/spf13/viper"
)

type Config struct {
	appbase.Config `mapstructure:",squash"`
	// # EVENTS LOG CONFIG - settings for events log
	eventslog.EventsLogConfig `mapstructure:",squash"`

	DatabaseURL string `mapstructure:"DATABASE_URL"`
	// in case of different visibility of database side car may require different db hostname
	SidecarDatabaseURL string `mapstructure:"SIDECAR_DATABASE_URL"`

	// # Kubernetes

	// KubernetesNamespace namespace of bulker app. Default: `default`
	KubernetesNamespace    string `mapstructure:"KUBERNETES_NAMESPACE" default:"default"`
	KubernetesClientConfig string `mapstructure:"KUBERNETES_CLIENT_CONFIG" default:"local"`
	KubernetesContext      string `mapstructure:"KUBERNETES_CONTEXT"`
	// nodeSelector for sync pods in json format, e.g: {"disktype": "ssd"}
	KubernetesNodeSelector string `mapstructure:"KUBERNETES_NODE_SELECTOR"`

	ContainerStatusCheckSeconds   int `mapstructure:"CONTAINER_STATUS_CHECK_SECONDS" default:"10"`
	ContainerGraceShutdownSeconds int `mapstructure:"CONTAINER_GRACE_SHUTDOWN_SECONDS" default:"60"`
	ContainerInitTimeoutSeconds   int `mapstructure:"CONTAINER_INIT_TIMEOUT_SECONDS" default:"180"`

	TaskTimeoutHours int `mapstructure:"TASK_TIMEOUT_HOURS" default:"48"`

	SidecarImage       string `mapstructure:"SIDECAR_IMAGE" default:"jitsucom/sidecar:latest"`
	PodsServiceAccount string `mapstructure:"PODS_SERVICE_ACCOUNT"`

	LocalIngestEndpoint  string `mapstructure:"LOCAL_INGEST_ENDPOINT"`
	GlobalIngestEndpoint string `mapstructure:"GLOBAL_INGEST_ENDPOINT"`

	ConsoleURL   string `mapstructure:"CONSOLE_URL"`
	ConsoleToken string `mapstructure:"CONSOLE_TOKEN"`

	LogLevel   string `mapstructure:"LOG_LEVEL" default:"INFO"`
	DBLogLevel string `mapstructure:"DB_LOG_LEVEL" default:"INFO"`
}

func init() {
	viper.SetDefault("HTTP_PORT", utils.NvlString(os.Getenv("PORT"), "3043"))
}

func (c *Config) PostInit(settings *appbase.AppSettings) error {
	if c.KubernetesClientConfig == "" {
		return fmt.Errorf("KUBERNETES_CLIENT_CONFIG is required")
	}
	return c.Config.PostInit(settings)
}
