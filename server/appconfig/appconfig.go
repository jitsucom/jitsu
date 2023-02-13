package appconfig

import (
	"encoding/base64"
	"fmt"
	"io"
	"io/ioutil"
	"os"
	"path"
	"strings"

	"github.com/jitsucom/jitsu/server/identifiers"

	"github.com/jitsucom/jitsu/server/authorization"
	"github.com/jitsucom/jitsu/server/logging"
	"github.com/jitsucom/jitsu/server/useragent"
	"github.com/spf13/viper"
)

const (
	emptyGIFOnexOne       = "R0lGODlhAQABAIAAAAAAAP8AACH5BAEAAAEALAAAAAABAAEAAAICTAEAOw=="
	localAirbyteConfigDir = "airbyte_config"
)

// AppConfig is a main Application Global Configuration
type AppConfig struct {
	ServerName string
	Authority  string
	ConfigPath string

	ConfiguratorURL   string
	ConfiguratorToken string

	DisableSkipEventsWarn bool

	EmptyGIFPixelOnexOne []byte

	UaResolver           useragent.Resolver
	AuthorizationService *authorization.Service

	GlobalDDLLogsWriter   io.Writer
	GlobalQueryLogsWriter io.Writer
	SingerLogsWriter      io.Writer
	AirbyteLogsWriter     io.Writer
	SourcesLogsWriter     io.Writer

	GlobalUniqueIDField   *identifiers.UniqueID
	EnrichWithHTTPContext bool

	closeMe     []io.Closer
	lastCloseMe []io.Closer

	eventsConsumers []io.Closer
	writeAheadLog   io.Closer
}

var (
	Instance     *AppConfig
	RawVersion   string
	MajorVersion string
	BuiltAt      string
	MinorVersion string
	Beta         bool
)

func setDefaultParams(containerized bool) {
	defaultServerName, _ := os.Hostname()
	if defaultServerName == "" {
		defaultServerName = "unnamed-server"
	}
	viper.SetDefault("server.name", defaultServerName)
	viper.SetDefault("server.port", "8001")
	viper.SetDefault("server.log.level", "info")
	viper.SetDefault("server.auth_reload_sec", 1)
	viper.SetDefault("server.api_keys_reload_sec", 1)
	viper.SetDefault("server.destinations_reload_sec", 1)
	viper.SetDefault("server.sources_reload_sec", 1)
	viper.SetDefault("server.geo_resolvers_reload_sec", 1)
	viper.SetDefault("server.sync_tasks.pool.size", 16)
	viper.SetDefault("server.sync_tasks.stalled.last_heartbeat_threshold_seconds", 60)
	viper.SetDefault("server.sync_tasks.stalled.last_activity_threshold_minutes", 10)
	viper.SetDefault("server.sync_tasks.stalled.observe_stalled_every_seconds", 20)
	viper.SetDefault("server.sync_tasks.store_logs.last_runs", 100)
	viper.SetDefault("server.disable_version_reminder", false)
	viper.SetDefault("server.disable_skip_events_warn", false)
	viper.SetDefault("server.cache.enabled", true)
	viper.SetDefault("server.cache.events.size", 100)
	viper.SetDefault("server.cache.events.time_window_sec", 60)
	viper.SetDefault("server.cache.events.trim_interval_ms", 500)
	viper.SetDefault("server.cache.events.max_malformed_event_size_bytes", 10_000)
	viper.SetDefault("server.cache.pool.size", 10)
	viper.SetDefault("server.strict_auth_tokens", false)
	viper.SetDefault("server.max_columns", 100)
	viper.SetDefault("server.max_event_size", 51200)
	viper.SetDefault("server.configurator_urn", "/configurator")
	//unique IDs
	viper.SetDefault("server.fields_configuration.unique_id_field", "/eventn_ctx/event_id||/eventn_ctx_event_id||/event_id")
	viper.SetDefault("server.fields_configuration.user_agent_path", "/eventn_ctx/user_agent||/user_agent")
	//default enrichment rules
	viper.SetDefault("server.fields_configuration.src_source_ip", "/source_ip")
	viper.SetDefault("server.fields_configuration.dst_source_ip", "/eventn_ctx/location||/location")
	viper.SetDefault("server.fields_configuration.src_ua", "/eventn_ctx/user_agent||/user_agent")
	viper.SetDefault("server.fields_configuration.dst_ua", "/eventn_ctx/parsed_ua||/parsed_ua")

	viper.SetDefault("log.show_in_server", false)
	viper.SetDefault("log.async_writers", false)
	viper.SetDefault("log.pool.size", 10)
	viper.SetDefault("log.rotation_min", 5)

	viper.SetDefault("batch_uploader.threads_count", 1)
	viper.SetDefault("streaming.threads_count", 1)

	viper.SetDefault("sql_debug_log.ddl.enabled", true)
	viper.SetDefault("sql_debug_log.ddl.rotation_min", "1440")
	viper.SetDefault("sql_debug_log.ddl.max_backups", "365") //1 year = 1440 min * 365
	viper.SetDefault("sql_debug_log.queries.enabled", false)
	viper.SetDefault("sql_debug_log.queries.rotation_min", "60")
	viper.SetDefault("sql_debug_log.queries.max_backups", "7320") //30 days = 60 min * 7320

	viper.SetDefault("users_recognition.enabled", false)
	viper.SetDefault("users_recognition.anonymous_id_node", "/eventn_ctx/user/anonymous_id||/user/anonymous_id||/eventn_ctx/user/hashed_anonymous_id||/user/hashed_anonymous_id")
	viper.SetDefault("users_recognition.identification_nodes", []string{"/eventn_ctx/user/id||/user/id", "/eventn_ctx/user/email||/user/email", "/eventn_ctx/user/internal_id||/user/internal_id"}) // internal_id is DEPRECATED and is set for backward compatibility
	viper.SetDefault("users_recognition.pool.size", 10)
	viper.SetDefault("users_recognition.cache_ttl_min", 180)

	viper.SetDefault("singer-bridge.python", "python3")
	viper.SetDefault("singer-bridge.install_taps", true)
	viper.SetDefault("singer-bridge.update_taps", false)
	viper.SetDefault("singer-bridge.log.enabled", false)
	viper.SetDefault("singer-bridge.log.rotation_min", "1440")
	viper.SetDefault("singer-bridge.log.max_backups", "30") //30 days = 1440 min * 30
	viper.SetDefault("singer-bridge.batch_size", 10_000)

	viper.SetDefault("airbyte-bridge.log.enabled", false)
	viper.SetDefault("airbyte-bridge.log.rotation_min", "1440")
	viper.SetDefault("airbyte-bridge.log.max_backups", "30") //30 days = 1440 min * 30
	viper.SetDefault("airbyte-bridge.batch_size", 10_000)

	viper.SetDefault("sync-tasks.log.enabled", true)
	viper.SetDefault("sync-tasks.log.path", logging.GlobalType)
	viper.SetDefault("sync-tasks.store_attempts", 3)

	//User Recognition anonymous events default TTL 10080 min - 7 days
	viper.SetDefault("meta.storage.redis.ttl_minutes.anonymous_events", 10080)

	//MaxMind URL
	viper.SetDefault("maxmind.official_url", "https://download.maxmind.com/app/geoip_download?license_key=%s&edition_id=%s&suffix=tar.gz")

	//Segment API mappings
	//uses remove type mappings (e.g. "/page->") because we have root path mapping "/context -> /"
	viper.SetDefault("compatibility.segment.endpoint", []string{
		"/context/page/title -> /page_title",
		"/context/page -> /doc",
		"/context/page/referrer -> /referer",
		"/page->",
		"/traits -> /user",
		"/context/traits -> /user",
		"/traits->",
		"/context/userAgent -> /user_agent",
		"/userAgent->",
		"/anonymousId -> /ids/ajs_anonymous_id",
		"/anonymousId -> /user/anonymous_id",
		"/userId -> /ids/ajs_user_id",
		"/userId -> /user/internal_id",
		"/userId -> /user/id",
		"/context/campaign -> /utm",
		"/context/campaign/name -> /utm/campaign",
		"/campaign ->",
		"/context/location -> /location",
		"/context/referrer/url -> /referer",
		"/context/os/name -> /parsed_ua/os_family",
		"/context/os/version -> /parsed_ua/os_version",
		"/os ->",
		"/context/device/manufacturer -> /parsed_ua/device_brand",
		"/context/device/model -> /parsed_ua/device_model",
		"/context/device/version -> /parsed_ua/ua_version",
		"/context/device/advertisingId -> /parsed_ua/device_advertising_id",
		"/context/device/id -> /parsed_ua/device_id",
		"/context/device/name -> /parsed_ua/device_name",
		"/context/device/type -> /parsed_ua/device_type",
		"/device->",
		"/context/locale -> /user_language",
		"/type -> /event_type",
		"/context/ip -> /source_ip",
		"/ip -> ",
		"/locale -> ",
		"/context/user_agent -> /user_agent",
		"/properties -> /",
		"/context -> /",
	})

	//Segment compat API mappings
	//uses remove type mappings (e.g. "/page->") because we have root path mapping "/context -> /"
	viper.SetDefault("compatibility.segment_compat.endpoint", []string{
		"/context/page/title -> /eventn_ctx/page_title",
		"/context/page -> /eventn_ctx/doc",
		"/context/page/referrer -> /eventn_ctx/referer",
		"/page->",
		"/traits -> /eventn_ctx/user",
		"/context/traits -> /eventn_ctx/user",
		"/traits->",
		"/context/userAgent -> /eventn_ctx/user_agent",
		"/userAgent->",
		"/anonymousId -> /eventn_ctx/ids/ajs_anonymous_id",
		"/anonymousId -> /eventn_ctx/user/anonymous_id",
		"/userId -> /eventn_ctx/ids/ajs_user_id",
		"/userId -> /eventn_ctx/user/internal_id",
		"/context/campaign -> /eventn_ctx/utm",
		"/context/campaign/name -> /eventn_ctx/utm/campaign",
		"/campaign ->",
		"/context/location -> /eventn_ctx/location",
		"/location->",
		"/context/referrer/url -> /eventn_ctx/referer",
		"/context/os/name -> /eventn_ctx/parsed_ua/os_family",
		"/context/os/version -> /eventn_ctx/parsed_ua/os_version",
		"/os ->",
		"/context/device/manufacturer -> /eventn_ctx/parsed_ua/device_brand",
		"/context/device/model -> /eventn_ctx/parsed_ua/device_model",
		"/context/device/version -> /eventn_ctx/parsed_ua/ua_version",
		"/context/device/advertisingId -> /eventn_ctx/parsed_ua/device_advertising_id",
		"/context/device/id -> /eventn_ctx/parsed_ua/device_id",
		"/context/device/name -> /eventn_ctx/parsed_ua/device_name",
		"/context/device/type -> /eventn_ctx/parsed_ua/device_type",
		"/device->",
		"/context/locale -> /eventn_ctx/user_language",
		"/type -> /event_type",
		"/context/ip -> /source_ip",
		"/ip -> ",
		"/locale -> ",
		"/context/user_agent -> /eventn_ctx/user_agent",
		"/properties -> /",
		"/context -> /",
	})

	// Default max Node.JS processes
	viper.SetDefault("node.pool_size", 1)
	viper.SetDefault("node.max_space", 100)
	viper.SetDefault("node.sources_max_space", 500)

	if containerized {
		viper.SetDefault("server.static_files_dir", "/home/eventnative/app/web")

		viper.SetDefault("log.path", "/home/eventnative/data/logs/events")
		viper.SetDefault("server.log.path", "/home/eventnative/data/logs")
		viper.SetDefault("server.config.path", "/home/eventnative/data/config")
		viper.SetDefault("server.plugins_cache", "/home/eventnative/data/cache")
		viper.SetDefault("singer-bridge.venv_dir", "/home/eventnative/data/venv")
		viper.SetDefault("singer-bridge.log.path", "/home/eventnative/data/logs")
		viper.SetDefault("airbyte-bridge.log.path", "/home/eventnative/data/logs")
		viper.SetDefault("airbyte-bridge.config_dir", "/home/eventnative/data/airbyte")
		viper.SetDefault("sql_debug_log.ddl.path", "/home/eventnative/data/logs")
		viper.SetDefault("sql_debug_log.queries.path", "/home/eventnative/data/logs")
		viper.SetDefault("server.volumes.workspace", "jitsu_workspace")
	} else {
		viper.SetDefault("server.static_files_dir", "./web")

		viper.SetDefault("log.path", "./logs/events")
		viper.SetDefault("server.log.path", "./logs")
		viper.SetDefault("sql_debug_log.ddl.path", "./logs")
		viper.SetDefault("sql_debug_log.queries.path", "./logs")
		viper.SetDefault("server.config.path", "./config")
		viper.SetDefault("server.plugins_cache", "./cache")
		viper.SetDefault("singer-bridge.venv_dir", "./venv")
		viper.SetDefault("singer-bridge.log.path", "./logs")
		viper.SetDefault("airbyte-bridge.log.path", "./logs")
		workingDir, _ := os.Getwd()
		viper.SetDefault("airbyte-bridge.config_dir", path.Join(workingDir, localAirbyteConfigDir))
		viper.SetDefault("server.volumes.workspace", path.Join(workingDir, localAirbyteConfigDir)) //should be the same as airbyte-bridge.config_dir
	}
}

func Init(containerized bool, dockerHubID string) error {
	setDefaultParams(containerized)

	serverName := viper.GetString("server.name")
	globalLoggerConfig := logging.Config{
		FileName:      serverName + "-main",
		FileDir:       viper.GetString("server.log.path"),
		RotationMin:   viper.GetInt64("server.log.rotation_min"),
		MaxFileSizeMb: viper.GetInt("server.log.max_file_size_mb"),
		MaxBackups:    viper.GetInt("server.log.max_backups")}

	//Global logger writes logs and sends system error notifications
	//
	//   configured file logger            no file logger configured
	//     /             \                            |
	// os.Stdout      FileWriter                  os.Stdout
	if globalLoggerConfig.FileDir != "" && globalLoggerConfig.FileDir != logging.GlobalType {
		fileWriter := logging.NewRollingWriter(&globalLoggerConfig)
		logging.GlobalLogsWriter = logging.Dual{
			FileWriter: fileWriter,
			Stdout:     os.Stdout,
		}
	} else {
		logging.GlobalLogsWriter = os.Stdout
	}
	err := logging.InitGlobalLogger(logging.GlobalLogsWriter, viper.GetString("server.log.level"))
	if err != nil {
		return err
	}

	logWelcomeBanner(RawVersion)
	logDeprecatedImageUsage(dockerHubID)

	if globalLoggerConfig.FileDir != "" {
		logging.Infof("📂 Using server.log.path directory: %q", globalLoggerConfig.FileDir)
	}

	logging.Infof("🚀 Starting Jitsu Server. Server name: %s", serverName)
	publicURL := viper.GetString("server.public_url")
	if publicURL == "" {
		logging.Info("💻 Server public url will be taken from Host header")
	} else {
		logging.Infof("💻 Server public url: %s", publicURL)
	}

	var appConfig AppConfig
	appConfig.ServerName = serverName
	appConfig.ConfigPath = viper.GetString("server.config.path")

	appConfig.ConfiguratorURL = strings.TrimRight(viper.GetString("configurator.base_url"), "/")
	appConfig.ConfiguratorToken = viper.GetString("configurator.admin_token")

	emptyGIF, err := base64.StdEncoding.DecodeString(emptyGIFOnexOne)
	if err != nil {
		return fmt.Errorf("Error parsing empty GIF: %v", err)
	}
	appConfig.EmptyGIFPixelOnexOne = emptyGIF

	// SQL DDL debug writer
	if viper.GetBool("sql_debug_log.ddl.enabled") {
		appConfig.GlobalDDLLogsWriter = logging.CreateLogWriter(&logging.Config{
			FileName:      serverName + "-" + logging.DDLLogerType,
			FileDir:       viper.GetString("sql_debug_log.ddl.path"),
			RotationMin:   viper.GetInt64("sql_debug_log.ddl.rotation_min"),
			MaxFileSizeMb: viper.GetInt("sql_debug_log.ddl.max_file_size_mb"),
			MaxBackups:    viper.GetInt("sql_debug_log.ddl.max_backups")})
	}

	// SQL queries debug writer
	if viper.GetBool("sql_debug_log.queries.enabled") {
		appConfig.GlobalQueryLogsWriter = logging.CreateLogWriter(&logging.Config{
			FileName:      serverName + "-" + logging.QueriesLoggerType,
			FileDir:       viper.GetString("sql_debug_log.queries.path"),
			RotationMin:   viper.GetInt64("sql_debug_log.queries.rotation_min"),
			MaxFileSizeMb: viper.GetInt("sql_debug_log.queries.max_file_size_mb"),
			MaxBackups:    viper.GetInt("sql_debug_log.queries.max_backups")})
	}

	// Singer logger
	if viper.GetBool("singer-bridge.log.enabled") {
		if viper.GetString("singer-bridge.log.path") == logging.GlobalType {
			appConfig.SingerLogsWriter = logging.CreateLogWriter(&logging.Config{FileDir: logging.GlobalType})
		} else {
			appConfig.SingerLogsWriter = logging.CreateLogWriter(&logging.Config{
				FileName:      serverName + "-" + "singer",
				FileDir:       viper.GetString("singer-bridge.log.path"),
				RotationMin:   viper.GetInt64("singer-bridge.log.rotation_min"),
				MaxFileSizeMb: viper.GetInt("singer-bridge.log.max_file_size_mb"),
				MaxBackups:    viper.GetInt("singer-bridge.log.max_backups")})
		}
	}

	//Airbyte logger
	if viper.GetBool("airbyte-bridge.log.enabled") {
		if viper.GetString("airbyte-bridge.log.path") == logging.GlobalType {
			appConfig.AirbyteLogsWriter = logging.CreateLogWriter(&logging.Config{FileDir: logging.GlobalType})
		} else {

			appConfig.AirbyteLogsWriter = logging.CreateLogWriter(&logging.Config{
				FileName:      serverName + "-" + "airbyte",
				FileDir:       viper.GetString("airbyte-bridge.log.path"),
				RotationMin:   viper.GetInt64("airbyte-bridge.log.rotation_min"),
				MaxFileSizeMb: viper.GetInt("airbyte-bridge.log.max_file_size_mb"),
				MaxBackups:    viper.GetInt("airbyte-bridge.log.max_backups")})
		}
	}

	//Sources logger
	if viper.GetBool("sync-tasks.log.enabled") {
		if viper.GetString("sync-tasks.log.path") == logging.GlobalType {
			appConfig.SourcesLogsWriter = logging.CreateLogWriter(&logging.Config{FileDir: logging.GlobalType})
		} else {
			appConfig.SourcesLogsWriter = logging.CreateLogWriter(&logging.Config{
				FileName:      serverName + "-" + "sync-tasks",
				FileDir:       viper.GetString("sync-tasks.log.path"),
				RotationMin:   viper.GetInt64("sync-tasks.log.rotation_min"),
				MaxFileSizeMb: viper.GetInt("sync-tasks.log.max_file_size_mb"),
				MaxBackups:    viper.GetInt("sync-tasks.log.max_backups")})
		}
	} else {
		appConfig.SourcesLogsWriter = ioutil.Discard
	}

	port := viper.GetString("server.port")
	appConfig.Authority = "0.0.0.0:" + port

	authService, err := authorization.NewService(appConfig.ConfiguratorURL, appConfig.ConfiguratorToken)
	if err != nil {
		return err
	}

	uniqueIDField := viper.GetString("server.fields_configuration.unique_id_field")
	if uniqueIDField == "" {
		return fmt.Errorf("server.fields_configuration.unique_id_field is required parameter")
	}

	appConfig.AuthorizationService = authService
	extraBotKeywords := viper.GetStringSlice("server.ua.bot_keywords")
	appConfig.UaResolver = useragent.NewResolver(extraBotKeywords)
	appConfig.DisableSkipEventsWarn = viper.GetBool("server.disable_skip_events_warn")
	appConfig.GlobalUniqueIDField = identifiers.NewUniqueID(uniqueIDField)

	enrichWithHTTPContext := viper.GetBool("server.event_enrichment.http_context")
	appConfig.EnrichWithHTTPContext = enrichWithHTTPContext

	Instance = &appConfig
	return nil
}

func (a *AppConfig) ScheduleClosing(c io.Closer) {
	a.closeMe = append(a.closeMe, c)
}

func (a *AppConfig) Close() {
	for _, cl := range a.closeMe {
		if err := cl.Close(); err != nil {
			logging.Error(err)
		}
	}
}

// ScheduleEventsConsumerClosing adds events consumer closer into slice for closing
func (a *AppConfig) ScheduleEventsConsumerClosing(c io.Closer) {
	a.eventsConsumers = append(a.eventsConsumers, c)
}

// CloseEventsConsumers closes events queues(streaming) and loggers(batch) in the last call
// for preventing losing events
func (a *AppConfig) CloseEventsConsumers() {
	for _, ec := range a.eventsConsumers {
		if err := ec.Close(); err != nil {
			logging.Errorf("[EventsConsumer] %v", err)
		}
	}
}

// ScheduleWriteAheadLogClosing adds wal.Service closer
func (a *AppConfig) ScheduleWriteAheadLogClosing(c io.Closer) {
	a.writeAheadLog = c
}

// CloseWriteAheadLog closes write-ahead-log service in the last call
func (a *AppConfig) CloseWriteAheadLog() {
	if err := a.writeAheadLog.Close(); err != nil {
		logging.Errorf("[WriteAheadLog] %v", err)
	}
}

// ScheduleLastClosing adds meta.Storage, coordinationService closers
func (a *AppConfig) ScheduleLastClosing(c io.Closer) {
	a.lastCloseMe = append(a.lastCloseMe, c)
}

// CloseLast closes meta.Storage, coordinationService closers in the last call
func (a *AppConfig) CloseLast() {
	for _, cl := range a.lastCloseMe {
		if err := cl.Close(); err != nil {
			logging.Error(err)
		}
	}
}
