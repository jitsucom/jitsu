package amplitude

import (
	"errors"
)

type AmplitudeConfig struct {
	ApiKey    string `mapstructure:"api_key" json:"api_key,omitempty" yaml:"api_key,omitempty"`
	SecretKey string `mapstructure:"secret_key" json:"secret_key,omitempty" yaml:"secret_key,omitempty"`
	Server    string `mapstructure:"server" json:"server,omitempty" yaml:"server,omitempty"`
}

func (ac *AmplitudeConfig) Validate() error {
	if ac == nil {
		return errors.New("Amplitude config is required")
	}

	if ac.ApiKey == "" {
		return errors.New("Amplitude api_key is required")
	}

	if ac.SecretKey == "" {
		return errors.New("Amplitude secret_key is required")
	}

	return nil
}
