package main

import (
	"crypto/sha256"
	"encoding/hex"
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
	// nodeSelector for sync pods in json format, e.g: {"disktype": "ssd"}
	KubernetesNodeSelector        string `mapstructure:"KUBERNETES_NODE_SELECTOR"`
	PodsServiceAccount            string `mapstructure:"PODS_SERVICE_ACCOUNT"`
	PodsTolerations               string `mapstructure:"PODS_TOLERATIONS"`                 // tolerations for sync pods in json format
	PodsResources                 string `mapstructure:"PODS_RESOURCES"`                   // resource requests/limits for sync pods in json format
	PodsResourcesPremium          string `mapstructure:"PODS_RESOURCES_PREMIUM"`           // resource requests/limits for premium tier pods in json format
	PodsTopologySpreadConstraints string `mapstructure:"PODS_TOPOLOGY_SPREAD_CONSTRAINTS"` // topology spread constraints for sync pods in json format

	// Functions server configuration
	FunctionsServerImage string `mapstructure:"FUNCTIONS_SERVER_IMAGE" default:"jitsucom/rotor:latest"`
	FunctionsServerPort  int    `mapstructure:"FUNCTIONS_SERVER_PORT" default:"3456"`

	// Service configuration
	ServiceType string `mapstructure:"SERVICE_TYPE" default:"ClusterIP"`

	// Default functions class for workspaces without the feature flag (dedicated, free, legacy, or empty to ignore)
	DefaultFunctionsClass string `mapstructure:"DEFAULT_FUNCTIONS_CLASS" default:""`

	// MongoDB configuration for functions-server persistent store
	// If set, mongobetween sidecar will be added to proxy MongoDB connections
	MongoDBURL string `mapstructure:"MONGODB_URL"`
	// Mongobetween image to use as sidecar
	MongobetweenImage string `mapstructure:"MONGOBETWEEN_IMAGE" default:"jitsucom/mongobetween:0.0.3"`
	// Port for mongobetween to listen on (functions-server connects to this)
	MongobetweenPort          int `mapstructure:"MONGOBETWEEN_PORT" default:"27017"`
	MongoDBTimeoutMs          int `mapstructure:"MONGODB_TIMEOUT_MS" default:"1000"`
	MongoDBMaxPoolSize        int `mapstructure:"MONGODB_MAX_POOL_SIZE" default:"5"`
	MongoDBMaxPoolSizePremium int `mapstructure:"MONGODB_MAX_POOL_SIZE_PREMIUM" default:"20"`

	FastStoreWorkspaceIDs string `mapstructure:"FAST_STORE_WORKSPACE_IDS"` // comma-separated list of workspace IDs that should use mongobetween sidecar

	// Minimum number of replicas
	MinReplicas        int32 `mapstructure:"MIN_REPLICAS" default:"2"`
	MinReplicasPremium int32 `mapstructure:"MIN_REPLICAS_PREMIUM" default:"4"`

	// HPA configuration
	// Enable HPA for functions-server deployments
	HPAEnabled bool `mapstructure:"HPA_ENABLED" default:"false"`
	// Maximum number of replicas
	HPAMaxReplicas int32 `mapstructure:"HPA_MAX_REPLICAS" default:"16"`
	// Target CPU utilization percentage
	HPATargetCPUUtilization int32 `mapstructure:"HPA_TARGET_CPU_UTILIZATION" default:"100"`
	// Scale down stabilization window in seconds
	HPAScaleDownStabilizationSeconds int32 `mapstructure:"HPA_SCALE_DOWN_STABILIZATION_SECONDS" default:"300"`
	// Scale up stabilization window in seconds
	HPAScaleUpStabilizationSeconds int32 `mapstructure:"HPA_SCALE_UP_STABILIZATION_SECONDS" default:"0"`
}

func init() {
	viper.SetDefault("HTTP_PORT", utils.NvlString(os.Getenv("PORT"), "3052"))
}

func (c *Config) PostInit(settings *appbase.AppSettings) error {
	if c.RepositoryBaseURL == "" {
		return fmt.Errorf("REPOSITORY_URL is required")
	}
	return c.Config.PostInit(settings)
}

// CalculateOperatorConfigHash calculates a hash of Config fields that affect deployments.
// When this hash changes, deployments should be updated to reflect the new configuration.
func (c *Config) CalculateOperatorConfigHash() string {
	h := sha256.New()

	// Include all config fields that affect deployment specs
	h.Write([]byte(c.FunctionsServerImage))
	h.Write([]byte(fmt.Sprintf("%d", c.FunctionsServerPort)))
	h.Write([]byte(c.ServiceType))
	h.Write([]byte(c.KubernetesNodeSelector))
	h.Write([]byte(c.PodsTolerations))
	h.Write([]byte(c.PodsResources))
	h.Write([]byte(c.PodsResourcesPremium))
	h.Write([]byte(c.PodsTopologySpreadConstraints))
	h.Write([]byte(c.PodsServiceAccount))
	h.Write([]byte(c.MongoDBURL))
	h.Write([]byte(c.MongobetweenImage))
	h.Write([]byte(fmt.Sprintf("%d", c.MongobetweenPort)))
	h.Write([]byte(fmt.Sprintf("%d", c.MongoDBTimeoutMs)))
	h.Write([]byte(fmt.Sprintf("%d", c.MongoDBMaxPoolSize)))
	h.Write([]byte(fmt.Sprintf("%d", c.MongoDBMaxPoolSizePremium)))
	h.Write([]byte(c.FastStoreWorkspaceIDs))

	// HPA config
	h.Write([]byte(fmt.Sprintf("%t", c.HPAEnabled)))
	h.Write([]byte(fmt.Sprintf("%d", c.MinReplicas)))
	h.Write([]byte(fmt.Sprintf("%d", c.HPAMaxReplicas)))
	h.Write([]byte(fmt.Sprintf("%d", c.HPATargetCPUUtilization)))
	h.Write([]byte(fmt.Sprintf("%d", c.HPAScaleDownStabilizationSeconds)))
	h.Write([]byte(fmt.Sprintf("%d", c.HPAScaleUpStabilizationSeconds)))

	return hex.EncodeToString(h.Sum(nil))[:16]
}
