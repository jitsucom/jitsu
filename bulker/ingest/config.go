package main

import (
	"os"
	"strings"

	"github.com/jitsucom/bulker/eventslog"
	"github.com/jitsucom/bulker/jitsubase/appbase"
	"github.com/jitsucom/bulker/jitsubase/utils"
	"github.com/jitsucom/bulker/kafkabase"
	"github.com/spf13/viper"
)

type Config struct {
	// # BASE CONFIG - base setting for jitsu apps
	appbase.Config `mapstructure:",squash"`
	// # KAFKA CONFIG - base kafka setting
	kafkabase.KafkaConfig `mapstructure:",squash"`
	// # EVENTS LOG CONFIG - settings for events log
	eventslog.EventsLogConfig `mapstructure:",squash"`

	// # REPOSITORY CONFIG - settings for loading streams from repository
	RepositoryConfig `mapstructure:",squash"`

	// data domain for ingest endpoint. Required for using 'slug' to identify Stream. e.g. in ingest URL like `http://{slug}.{DATA_DOMAIN}/`
	DataDomain string `mapstructure:"DATA_DOMAIN"`
	// alternative to DataDomain. data domain will be extracted from this url
	PublicURL string `mapstructure:"PUBLIC_URL"`

	// For ingest endpoint only
	GlobalHashSecret string `mapstructure:"GLOBAL_HASH_SECRET" default:"dea42a58-acf4-45af-85bb-e77e94bd5025"`
	// For ingest endpoint only
	GlobalHashSecrets []string

	// URL to fetch p.js javascript code from
	ScriptOrigin string `mapstructure:"SCRIPT_ORIGIN" default:"https://cdn.jsdelivr.net/npm/@jitsu/js@latest/dist/web/p.js.txt"`

	//Cache dir for repository and javascript data
	CacheDir string `mapstructure:"CACHE_DIR"`

	BackupLogDir         string `mapstructure:"BACKUP_LOG_DIR"`
	BackupLogTTL         int    `mapstructure:"BACKUP_LOG_TTL_DAYS" default:"7"`
	BackupLogRotateHours int    `mapstructure:"BACKUP_LOG_ROTATE_HOURS" default:"24"`
	BackupLogMaxSizeMb   int    `mapstructure:"BACKUP_LOG_MAX_SIZE_MB" default:"100"`

	// # EVENTS REDIS LOGGING

	RedisURL         string `mapstructure:"REDIS_URL"`
	RedisTLSCA       string `mapstructure:"REDIS_TLS_CA"`
	EventsLogMaxSize int    `mapstructure:"EVENTS_LOG_MAX_SIZE" default:"1000"`

	RotorAuthKey               string `mapstructure:"ROTOR_AUTH_KEY"`
	FunctionsServerURLTemplate string `mapstructure:"FUNCTIONS_SERVER_URL_TEMPLATE" default:"http://fs-${workspaceId}:3456"`
	DefaultFunctionsClass      string `mapstructure:"DEFAULT_FUNCTIONS_CLASS" default:"free"`
	DeviceFunctionsTimeoutMs   int    `mapstructure:"DEVICE_FUNCTIONS_TIMEOUT_MS" default:"200"`

	MetricsPort int `mapstructure:"METRICS_PORT" default:"9091"`

	// Destination id of the special "metrics" bulker destination that owns the
	// `metrics` and `active_incoming` Kafka batch topics. The synchronous
	// function-server paths (/api/funcs/:conId and processSyncDestination) produce
	// billing + connection metrics to those topics. Empty disables the emission.
	MetricsDestinationId string `mapstructure:"METRICS_DESTINATION_ID" default:"metrics"`

	MaxIngestPayloadSize int `mapstructure:"MAX_INGEST_PAYLOAD_SIZE" default:"1000000"`

	WeightedPartitionSelectorLagThreshold int64 `mapstructure:"WEIGHTED_PARTITION_SELECTOR_LAG_THRESHOLD" default:"0"`
	// # GRACEFUL SHUTDOWN
	//Timeout that give running batch tasks time to finish during shutdown.
	ShutdownTimeoutSec int `mapstructure:"SHUTDOWN_TIMEOUT_SEC" default:"10"`
	//Extra delay may be needed. E.g. for metric scrapper to scrape final metrics. So http server will stay active for an extra period.
	ShutdownExtraDelay int `mapstructure:"SHUTDOWN_EXTRA_DELAY_SEC" default:"5"`
}

func init() {
	viper.SetDefault("HTTP_PORT", utils.NvlString(os.Getenv("PORT"), "3049"))
}

func (ac *Config) PostInit(settings *appbase.AppSettings) error {
	err := ac.Config.PostInit(settings)
	if err != nil {
		return err
	}
	ac.GlobalHashSecrets = strings.Split(ac.GlobalHashSecret, ",")
	return nil
}
