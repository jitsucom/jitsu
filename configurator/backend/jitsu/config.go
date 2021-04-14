package jitsu

import (
	"errors"
)

type SSHConfig struct {
	User           string `mapstructure:"user"`
	PrivateKeyPath string `mapstructure:"privateKeyPath"`
}

func (sc *SSHConfig) Validate() error {
	if sc == nil {
		return errors.New("jitsu.ssl.ssh is required config object")
	}

	if sc.User == "" {
		return errors.New("jitsu.ssl.ssh.user is required parameter")
	}

	if sc.PrivateKeyPath == "" {
		return errors.New("jitsu.ssl.ssh.privateKeyPath is required parameter")
	}

	return nil
}

type SSLConfig struct {
	SSH                  *SSHConfig `mapstructure:"ssh"`
	Hosts                []string   `mapstructure:"hosts"`
	CertificatePath      string     `mapstructure:"cert_path"`
	PKPath               string     `mapstructure:"pk_path"`
	NginxConfigPath      string     `mapstructure:"nginx_conf_path"`
	AcmeChallengePath    string     `mapstructure:"acme_challenge_path"`
	ServerConfigTemplate string     `mapstructure:"server_config_template"`
	Period               int        `mapstructure:"period"`
}

func (sc *SSLConfig) Validate() error {
	if sc == nil {
		return nil
	}

	err := sc.SSH.Validate()
	if err != nil {
		return err
	}

	if len(sc.Hosts) == 0 {
		return errors.New("jitsu.ssl.hosts is required parameter and mustn't be empty")
	}

	if sc.CertificatePath == "" {
		return errors.New("jitsu.ssl.cert_path is required parameter")
	}

	if sc.PKPath == "" {
		return errors.New("jitsu.ssl.pk_path is required parameter")
	}

	if sc.NginxConfigPath == "" {
		return errors.New("jitsu.ssl.nginx_conf_path is required parameter")
	}

	if sc.AcmeChallengePath == "" {
		return errors.New("jitsu.ssl.acme_challenge_path is required parameter")
	}

	if sc.ServerConfigTemplate == "" {
		return errors.New("jitsu.ssl.server_config_template is required parameter")
	}

	return nil
}

type Config struct {
	CName      string     `mapstructure:"cname"`
	BaseURL    string     `mapstructure:"base_url"`
	AdminToken string     `mapstructure:"admin_token"`
	SSL        *SSLConfig `mapstructure:"ssl"`
}

func (c *Config) Validate() error {
	if c.BaseURL == "" {
		return errors.New("jitsu.base_url is required parameter")
	}

	if c.AdminToken == "" {
		return errors.New("jitsu.admin_token is required parameter")
	}

	err := c.SSL.Validate()
	if err != nil {
		return err
	}

	return nil
}
