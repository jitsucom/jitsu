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

	// # Repository (syncs export polling)
	// RepositoryBaseURL is the URL of the console export endpoints, e.g.
	// "http://console:3000/api/admin/export". The "/syncs" path is appended.
	// If empty, the syncs repository is disabled — syncctl runs in legacy
	// reactive-only mode and won't manage CronJobs.
	RepositoryBaseURL          string `mapstructure:"REPOSITORY_BASE_URL"`
	RepositoryAuthToken        string `mapstructure:"REPOSITORY_AUTH_TOKEN"`
	RepositoryRefreshPeriodSec int    `mapstructure:"REPOSITORY_REFRESH_PERIOD_SEC" default:"30"`
	RepositoryCacheDir         string `mapstructure:"REPOSITORY_CACHE_DIR" default:"/tmp/syncctl-cache"`

	// # CronJob defaults (per autonomous sync run)
	// JobActiveDeadlineSeconds caps the total time a Job (Pending+Running)
	// can take before kubelet kills it. Doubles as the max-wait-for-resources
	// timeout: a Pod that can't schedule within this window is killed and the
	// Job is marked Failed. With JobBackoffLimit=0 the Job is not retried;
	// the next CronJob fire happens normally on the next schedule tick.
	JobActiveDeadlineSeconds int32 `mapstructure:"JOB_ACTIVE_DEADLINE_SECONDS" default:"1800"`
	JobBackoffLimit          int32 `mapstructure:"JOB_BACKOFF_LIMIT" default:"0"`

	// # Nango (OAuth refresh in autonomous sync Pods)
	// The oauth-refresh init container needs these to fetch fresh tokens
	// from Nango at run time. When unset, OAuth-using syncs proceed with
	// whatever tokens were embedded in the per-CronJob Secret at the last
	// syncs export poll — the init container logs a warning and falls
	// through. Tokens may be stale by the time the CronJob fires.
	NangoAPIHost            string `mapstructure:"NANGO_API_HOST"`
	NangoSecretKey          string `mapstructure:"NANGO_SECRET_KEY"`
	GoogleAdsDeveloperToken string `mapstructure:"GOOGLE_ADS_DEVELOPER_TOKEN"`

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
