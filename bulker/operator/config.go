package main

import (
	"fmt"
	"os"

	"github.com/jitsucom/bulker/jitsubase/appbase"
	"github.com/jitsucom/bulker/jitsubase/utils"
	"github.com/spf13/viper"
)

type Config struct {
	appbase.Config `mapstructure:",squash"`

	// Repository configuration
	RepositoryBaseURL          string `mapstructure:"REPOSITORY_BASE_URL"`
	RepositoryAuthToken        string `mapstructure:"REPOSITORY_AUTH_TOKEN"`
	RepositoryRefreshPeriodSec int    `mapstructure:"REPOSITORY_REFRESH_PERIOD_SEC" default:"10"`
	RepositoryCacheDir         string `mapstructure:"REPOSITORY_CACHE_DIR" default:"/tmp/operator-cache"`

	// Kubernetes configuration
	KubernetesNamespace    string `mapstructure:"KUBERNETES_NAMESPACE" default:"default"`
	KubernetesClientConfig string `mapstructure:"KUBERNETES_CLIENT_CONFIG" default:"local"`
	KubernetesContext      string `mapstructure:"KUBERNETES_CONTEXT"`
	PodsServiceAccount     string `mapstructure:"PODS_SERVICE_ACCOUNT"`

	// Functions server configuration
	FunctionsServerImage string `mapstructure:"FUNCTIONS_SERVER_IMAGE" default:"jitsucom/functions-server:latest"`
	FunctionsServerPort  int    `mapstructure:"FUNCTIONS_SERVER_PORT" default:"3456"`

	// Feature flag to look for in workspace
	DedicatedFeatureFlag string `mapstructure:"DEDICATED_FEATURE_FLAG" default:"functionsServer=dedicated"`
}

func init() {
	viper.SetDefault("HTTP_PORT", utils.NvlString(os.Getenv("PORT"), "3052"))
}

func (c *Config) PostInit(settings *appbase.AppSettings) error {
	if c.RepositoryBaseURL == "" {
		return fmt.Errorf("%sREPOSITORY_URL is required", settings.EnvPrefixWithUnderscore())
	}
	return c.Config.PostInit(settings)
}
