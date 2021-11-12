package adapters

import (
	"errors"
	"fmt"
	"path"
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

//SSLConfig is a dto for deserialized SSL configuration for Postgres
type SSLConfig struct {
	Mode       SSLMode `mapstructure:"mode" json:"mode,omitempty" yaml:"mode,omitempty"`
	ServerCA   string  `mapstructure:"server_ca" json:"server_ca,omitempty" yaml:"server_ca,omitempty"`
	ClientCert string  `mapstructure:"client_cert" json:"client_cert,omitempty" yaml:"client_cert,omitempty"`
	ClientKey  string  `mapstructure:"client_key" json:"client_key,omitempty" yaml:"client_key,omitempty"`
}

//Validate returns err if the ssl configuration is invalid
func (sc *SSLConfig) Validate() error {
	if sc == nil {
		return errors.New("'ssl' config is required")
	}

	if sc.Mode == Unknown {
		return errors.New("'ssl.mode' is required parameter")
	}

	if sc.Mode == SSLModeRequire || sc.Mode == SSLModeDisable {
		return nil
	}

	if sc.ServerCA == "" {
		return errors.New("'ssl.server_ca' is required parameter")
	}

	if sc.ClientCert == "" {
		return errors.New("'ssl.client_cert' is required parameter")
	}

	if sc.ClientKey == "" {
		return errors.New("'ssl.client_key' is required parameter")
	}

	return nil
}

//ProcessSSL serializes SSL payload (ca, client cert, key) into files and enrich parameters with SSL config
//ssl configuration might be file path as well as string content
func ProcessSSL(configDir, destinationID string, dsc *DataSourceConfig) error {
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

	dir := path.Join(configDir, destinationID)
	serverCAPath, err := getFilePath("server_ca", dir, dsc.SSLConfiguration.ServerCA)
	if err != nil {
		return fmt.Errorf("error saving server_ca: %v", err)
	}
	dsc.Parameters["sslrootcert"] = serverCAPath

	clientCertPath, err := getFilePath("client_cert", dir, dsc.SSLConfiguration.ClientCert)
	if err != nil {
		return fmt.Errorf("error saving client_cert: %v", err)
	}
	dsc.Parameters["sslcert"] = clientCertPath

	clientKeyPath, err := getFilePath("client_key", dir, dsc.SSLConfiguration.ClientKey)
	if err != nil {
		return fmt.Errorf("error saving client_key: %v", err)
	}
	dsc.Parameters["sslkey"] = clientKeyPath

	return nil
}
