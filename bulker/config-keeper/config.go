package main

import (
	"github.com/jitsucom/bulker/jitsubase/appbase"
	"github.com/jitsucom/bulker/jitsubase/utils"
	"github.com/spf13/viper"
	"os"
)

type Config struct {
	appbase.Config `mapstructure:",squash"`

	//Cache dir for repositories data
	CacheDir string `mapstructure:"CACHE_DIR"`

	ScriptOrigin string `mapstructure:"SCRIPT_ORIGIN" default:"https://cdn.jsdelivr.net/npm/@jitsu/js@latest/dist/web/p.js.txt"`

	RepositoryBaseURL          string `mapstructure:"REPOSITORY_BASE_URL"`
	RepositoryAuthToken        string `mapstructure:"REPOSITORY_AUTH_TOKEN"`
	RepositoryRefreshPeriodSec int    `mapstructure:"REPOSITORY_REFRESH_PERIOD_SEC" default:"5"`
	Repositories               string `mapstructure:"REPOSITORIES" default:"streams-with-destinations,workspaces-with-profiles,functions,rotor-connections,bulker-connections"`

	// Repository payload circuit breaker (JITSU-182): reject a refresh that
	// materially changes too many rows at once, keeping last-known-good.
	// See breaker.go
	BreakerEnabled          bool    `mapstructure:"BREAKER_ENABLED" default:"true"`
	BreakerMaxChangePercent float64 `mapstructure:"BREAKER_MAX_CHANGE_PERCENT" default:"50"`
	BreakerMinChangedRows   int     `mapstructure:"BREAKER_MIN_CHANGED_ROWS" default:"20"`
	// repositories guarded by the breaker (must be JSON-array payloads)
	BreakerRepositories string `mapstructure:"BREAKER_REPOSITORIES" default:"streams-with-destinations,workspaces-with-profiles,rotor-connections,bulker-connections"`
}

func init() {
	viper.SetDefault("HTTP_PORT", utils.NvlString(os.Getenv("PORT"), "3059"))
}

func (c *Config) PostInit(settings *appbase.AppSettings) error {
	return c.Config.PostInit(settings)
}
