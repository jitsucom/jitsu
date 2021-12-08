package adapters

import (
	"errors"
	"fmt"
	"github.com/jitsucom/jitsu/server/logging"
	"io/ioutil"
	"path"
	"strings"
)

const (
	SSLModeRequire    SSLMode = "require"
	SSLModeDisable    SSLMode = "disable"
	SSLModeVerifyCA   SSLMode = "verify-ca"
	SSLModeVerifyFull SSLMode = "verify-full"

	Unknown SSLMode = ""
)

type SSLMode string

func (s SSLMode) String() string {
	switch s {
	case SSLModeRequire:
		return string(SSLModeRequire)
	case SSLModeDisable:
		return string(SSLModeDisable)
	case SSLModeVerifyCA:
		return string(SSLModeVerifyCA)
	case SSLModeVerifyFull:
		return string(SSLModeVerifyFull)
	case Unknown:
		return string(Unknown)
	default:
		return ""
	}
}

func FromString(sslMode string) SSLMode {
	switch strings.TrimSpace(strings.ToLower(sslMode)) {
	case SSLModeRequire.String():
		return SSLModeRequire
	case SSLModeDisable.String():
		return SSLModeDisable
	case SSLModeVerifyCA.String():
		return SSLModeVerifyCA
	case SSLModeVerifyFull.String():
		return SSLModeVerifyFull
	default:
		logging.SystemErrorf("unknown SSL mode: %s", sslMode)
		return Unknown
	}
}

//SSLConfig is a dto for deserialized SSL configuration for Postgres
type SSLConfig struct {
	Mode       SSLMode `mapstructure:"mode,omitempty" json:"mode,omitempty" yaml:"mode,omitempty"`
	ServerCA   string  `mapstructure:"server_ca,omitempty" json:"server_ca,omitempty" yaml:"server_ca,omitempty"`
	ClientCert string  `mapstructure:"client_cert,omitempty" json:"client_cert,omitempty" yaml:"client_cert,omitempty"`
	ClientKey  string  `mapstructure:"client_key,omitempty" json:"client_key,omitempty" yaml:"client_key,omitempty"`
}

//Validate returns err if the ssl configuration is invalid
func (sc *SSLConfig) Validate() error {
	if sc == nil {
		return errors.New("'ssl' config is required")
	}

	if sc.Mode == Unknown {
		return errors.New("'ssl.mode' is required parameter")
	}

	if sc.Mode == SSLModeVerifyCA || sc.Mode == SSLModeVerifyFull {
		if sc.ServerCA == "" {
			return errors.New("'ssl.server_ca' is required parameter")
		}

		if sc.ClientCert == "" {
			return errors.New("'ssl.client_cert' is required parameter")
		}

		if sc.ClientKey == "" {
			return errors.New("'ssl.client_key' is required parameter")
		}
	}

	return nil
}

//SSLDir returns SSL dir
// /:path_to_configs/ssl/:ID
func SSLDir(dir, identifier string) string {
	return path.Join(dir, "ssl", identifier)
}

//ProcessSSL serializes SSL payload (ca, client cert, key) into files
//enriches input DataSourceConfig parameters with SSL config
//ssl configuration might be file path as well as string content
func ProcessSSL(dir string, dsc *DataSourceConfig) error {
	if dsc.SSLConfiguration == nil {
		return nil
	}

	if dsc.SSLConfiguration.Mode == SSLModeRequire {
		//default driver ssl mode
		return nil
	}

	dsc.Parameters["sslmode"] = dsc.SSLConfiguration.Mode.String()

	if dsc.SSLConfiguration.Mode == SSLModeDisable {
		//other parameters aren't required for disable mode
		return nil
	}

	if err := logging.EnsureDir(dir); err != nil {
		return fmt.Errorf("Error creating dir for SSL files: %v", err)
	}

	serverCAPath, err := getSSLFilePath("server_ca", dir, dsc.SSLConfiguration.ServerCA)
	if err != nil {
		return fmt.Errorf("error saving server_ca: %v", err)
	}
	dsc.Parameters["sslrootcert"] = serverCAPath

	clientCertPath, err := getSSLFilePath("client_cert", dir, dsc.SSLConfiguration.ClientCert)
	if err != nil {
		return fmt.Errorf("error saving client_cert: %v", err)
	}
	dsc.Parameters["sslcert"] = clientCertPath

	clientKeyPath, err := getSSLFilePath("client_key", dir, dsc.SSLConfiguration.ClientKey)
	if err != nil {
		return fmt.Errorf("error saving client_key: %v", err)
	}
	dsc.Parameters["sslkey"] = clientKeyPath

	return nil
}

//getSSLFilePath checks if input payload is filepath - returns it
//otherwise write payload as a file and returns abs file path
func getSSLFilePath(name, dir, payload string) (string, error) {
	if path.IsAbs(payload) {
		return payload, nil
	}

	filepath := path.Join(dir, name)
	err := ioutil.WriteFile(filepath, []byte(payload), 0600)
	return filepath, err
}
