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

	// KubernetesNamespace namespace of bulker app. Default: `default`
	KubernetesNamespace    string `mapstructure:"KUBERNETES_NAMESPACE" default:"default"`
	KubernetesClientConfig string `mapstructure:"KUBERNETES_CLIENT_CONFIG" default:"local"`
	KubernetesContext      string `mapstructure:"KUBERNETES_CONTEXT"`

	// InitialSetup if true, ingress-manager will create ingress on start
	InitialSetup bool `mapstructure:"INITIAL_SETUP" default:"false"`

	JitsuCnames              string `mapstructure:"JITSU_CNAMES" default:"cname.jitsu.com,cname2.jitsu.com"`
	CertificateMapName       string `mapstructure:"CERTIFICATE_MAP_NAME" default:"custom-domains"`
	GoogleServiceAccountJson string `mapstructure:"GOOGLE_SERVICE_ACCOUNT_JSON"`
	GoogleCloudProject       string `mapstructure:"GOOGLE_CLOUD_PROJECT"`
	// CleanupCerts if true, ingress-manager will delete Certificates and CertificateMapEntry for domain names that no longer leads to a valid cnames
	CleanupCerts bool `mapstructure:"CLEANUP_CERTS" default:"false"`
}

func init() {
	viper.SetDefault("HTTP_PORT", utils.NvlString(os.Getenv("PORT"), "3051"))
}

func (c *Config) PostInit(settings *appbase.AppSettings) error {
	if c.KubernetesClientConfig == "" {
		return fmt.Errorf("KUBERNETES_CLIENT_CONFIG is required")
	}
	return c.Config.PostInit(settings)
}
