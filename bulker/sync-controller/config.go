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

	// # Sync Pod Resources - resource limits and requests for sync task pods.
	// Allows overriding the default resource allocations for source and sidecar containers
	// spawned by syncctl. Values in millicores for CPU and mebibytes (MiB) for memory.

	// SourceCPURequest CPU request for the source (Airbyte connector) container in millicores. Default: 100
	SourceCPURequest int `mapstructure:"SOURCE_CPU_REQUEST_MILLICORES" default:"100"`
	// SourceCPULimit CPU limit for the source (Airbyte connector) container in millicores. Default: 1000
	SourceCPULimit int `mapstructure:"SOURCE_CPU_LIMIT_MILLICORES" default:"1000"`
	// SourceMemoryRequest memory request for the source container in MiB. Default: 256
	SourceMemoryRequest int `mapstructure:"SOURCE_MEMORY_REQUEST_MI" default:"256"`
	// SourceMemoryLimit memory limit for the source container in MiB. Default: 8192 (8Gi).
	// NOTE: must be adjusted together with SourceJavaOpts — JVM heap (Xmx) should be ~1Gi less
	// than the memory limit to leave room for non-heap JVM memory (metaspace, thread stacks, etc).
	// Example: 2048 MiB limit → -Xmx1500m, 4096 MiB limit → -Xmx3500m
	SourceMemoryLimit int `mapstructure:"SOURCE_MEMORY_LIMIT_MI" default:"8192"`
	// SourceJavaOpts JAVA_OPTS env var for the source container (controls JVM heap). Default: -Xmx7000m.
	// Must be consistent with SourceMemoryLimit — see note above.
	SourceJavaOpts string `mapstructure:"SOURCE_JAVA_OPTS" default:"-Xmx7000m"`

	// SidecarCPURequest CPU request for the sidecar container in millicores. Default: 0
	SidecarCPURequest int `mapstructure:"SIDECAR_CPU_REQUEST_MILLICORES" default:"0"`
	// SidecarCPULimit CPU limit for the sidecar container in millicores. Default: 500
	SidecarCPULimit int `mapstructure:"SIDECAR_CPU_LIMIT_MILLICORES" default:"500"`
	// SidecarMemoryRequest memory request for the sidecar container in MiB. Default: 0
	SidecarMemoryRequest int `mapstructure:"SIDECAR_MEMORY_REQUEST_MI" default:"0"`
	// SidecarMemoryLimit memory limit for the sidecar container in MiB. Default: 4096 (4Gi)
	SidecarMemoryLimit int `mapstructure:"SIDECAR_MEMORY_LIMIT_MI" default:"4096"`

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
