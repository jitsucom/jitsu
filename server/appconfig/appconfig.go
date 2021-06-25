package appconfig

import (
	"fmt"
	"github.com/jitsucom/jitsu/server/identifiers"
	"io"
	"os"

	"github.com/jitsucom/jitsu/server/authorization"
	"github.com/jitsucom/jitsu/server/geo"
	"github.com/jitsucom/jitsu/server/logging"
	"github.com/jitsucom/jitsu/server/useragent"
	"github.com/spf13/viper"
)

//AppConfig is a main Application Global Configuration
type AppConfig struct {
	ServerName string
	Authority  string

	DisableSkipEventsWarn bool

	GeoResolver          geo.Resolver
	UaResolver           useragent.Resolver
	AuthorizationService *authorization.Service

	GlobalDDLLogsWriter   io.Writer
	GlobalQueryLogsWriter io.Writer
	SingerLogsWriter      io.Writer

	GlobalUniqueIDField *identifiers.UniqueID

	closeMe []io.Closer

	eventsConsumers []io.Closer
}

var (
	Instance     *AppConfig
	RawVersion   string
	MajorVersion string
	MinorVersion string
	Beta         bool
)

func setDefaultParams(containerized bool) {
	viper.SetDefault("server.name", "unnamed-server")
	viper.SetDefault("server.port", "8001")
	viper.SetDefault("server.log.level", "info")
	viper.SetDefault("server.static_files_dir", "./web")
	viper.SetDefault("server.auth_reload_sec", 3)
	viper.SetDefault("server.api_keys_reload_sec", 3)
	viper.SetDefault("server.destinations_reload_sec", 5)
	viper.SetDefault("server.sources_reload_sec", 7)
	viper.SetDefault("server.sync_tasks.pool.size", 16)
	viper.SetDefault("server.disable_version_reminder", false)
	viper.SetDefault("server.disable_skip_events_warn", false)
	viper.SetDefault("server.cache.events.size", 100)
	viper.SetDefault("server.strict_auth_tokens", false)
	viper.SetDefault("server.max_columns", 100)
	viper.SetDefault("server.configurator_url", "/configurator")
	//unique IDs
	viper.SetDefault("server.fields_configuration.unique_id_field", "/eventn_ctx/event_id||/eventn_ctx_event_id||/event_id")
	viper.SetDefault("server.fields_configuration.user_agent_path", "/eventn_ctx/user_agent||/user_agent")
	//default enrichment rules
	viper.SetDefault("server.fields_configuration.src_source_ip", "/source_ip")
	viper.SetDefault("server.fields_configuration.dst_source_ip", "/eventn_ctx/location||/location")
	viper.SetDefault("server.fields_configuration.src_ua", "/eventn_ctx/user_agent||/user_agent")
	viper.SetDefault("server.fields_configuration.dst_ua", "/eventn_ctx/parsed_ua||/parsed_ua")

	viper.SetDefault("log.show_in_server", false)
	viper.SetDefault("log.rotation_min", 5)
	viper.SetDefault("sql_debug_log.queries.rotation_min", "1440")
	viper.SetDefault("sql_debug_log.ddl.rotation_min", "1440")
	viper.SetDefault("users_recognition.enabled", false)
	viper.SetDefault("users_recognition.anonymous_id_node", "/eventn_ctx/user/anonymous_id||/user/anonymous_id")
	viper.SetDefault("users_recognition.identification_nodes", []string{"/eventn_ctx/user/internal_id||/user/internal_id"})
	viper.SetDefault("singer-bridge.python", "python3")
	viper.SetDefault("singer-bridge.install_taps", true)
	viper.SetDefault("singer-bridge.log.rotation_min", "1440")

	//Segment API mappings
	//uses remove type mappings (e.g. "/page->") because we have root path mapping "/context -> /"
	viper.SetDefault("compatibility.segment.endpoint", []string{
		"/context/page/title -> /page_title",
		"/context/page -> /doc",
		"/page->",
		"/context/traits -> /user",
		"/traits->",
		"/context/userAgent -> /user_agent",
		"/userAgent->",
		"/anonymousId -> /ids/ajs_anonymous_id",
		"/anonymousId -> /user/anonymous_id",
		"/userId -> /ids/ajs_user_id",
		"/userId -> /user/internal_id",
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
		"/page->",
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

	if containerized {
		viper.SetDefault("log.path", "/home/eventnative/data/logs/events")
		viper.SetDefault("server.log.path", "/home/eventnative/data/logs")
		viper.SetDefault("singer-bridge.venv_dir", "/home/eventnative/data/venv")
	} else {
		viper.SetDefault("log.path", "./logs/events")
		viper.SetDefault("server.log.path", "./logs")
		viper.SetDefault("singer-bridge.venv_dir", "./venv")
	}
}

func Init(containerized bool, dockerHubID string) error {
	setDefaultParams(containerized)

	serverName := viper.GetString("server.name")
	globalLoggerConfig := logging.Config{
		FileName:    serverName + "-main",
		FileDir:     viper.GetString("server.log.path"),
		RotationMin: viper.GetInt64("server.log.rotation_min"),
		MaxBackups:  viper.GetInt("server.log.max_backups")}

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

	// SQL DDL debug writer
	if viper.IsSet("sql_debug_log.ddl.path") {
		ddlLoggerViper := viper.Sub("sql_debug_log.ddl")
		appConfig.GlobalDDLLogsWriter = logging.CreateLogWriter(&logging.Config{
			FileName:    serverName + "-" + logging.DDLLogerType,
			FileDir:     ddlLoggerViper.GetString("path"),
			RotationMin: ddlLoggerViper.GetInt64("rotation_min"),
			MaxBackups:  ddlLoggerViper.GetInt("max_backups")})
	}

	// SQL queries debug writer
	if viper.IsSet("sql_debug_log.queries.path") {
		queriesLoggerViper := viper.Sub("sql_debug_log.queries")
		appConfig.GlobalQueryLogsWriter = logging.CreateLogWriter(&logging.Config{
			FileName:    serverName + "-" + logging.QueriesLoggerType,
			FileDir:     queriesLoggerViper.GetString("path"),
			RotationMin: queriesLoggerViper.GetInt64("rotation_min"),
			MaxBackups:  queriesLoggerViper.GetInt("max_backups")})
	}

	// Singer logger
	if viper.IsSet("singer-bridge.log.path") {
		singerLoggerViper := viper.Sub("singer-bridge.log")
		appConfig.SingerLogsWriter = logging.CreateLogWriter(&logging.Config{
			FileName:    serverName + "-" + "singer",
			FileDir:     singerLoggerViper.GetString("path"),
			RotationMin: singerLoggerViper.GetInt64("rotation_min"),
			MaxBackups:  singerLoggerViper.GetInt("max_backups")})
	} else {
		appConfig.SingerLogsWriter = logging.CreateLogWriter(&logging.Config{FileDir: logging.GlobalType})
	}

	port := viper.GetString("server.port")
	appConfig.Authority = "0.0.0.0:" + port

	authService, err := authorization.NewService()
	if err != nil {
		return err
	}

	uniqueIDField := viper.GetString("server.fields_configuration.unique_id_field")
	if uniqueIDField == "" {
		return fmt.Errorf("server.fields_configuration.unique_id_field is required parameter")
	}

	appConfig.AuthorizationService = authService
	appConfig.UaResolver = useragent.NewResolver()
	appConfig.GeoResolver = loadGeoResolver()
	appConfig.DisableSkipEventsWarn = viper.GetBool("server.disable_skip_events_warn")
	appConfig.GlobalUniqueIDField = identifiers.NewUniqueID(uniqueIDField)

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

//ScheduleEventsConsumerClosing adds events consumer closer into slice for closing
func (a *AppConfig) ScheduleEventsConsumerClosing(c io.Closer) {
	a.eventsConsumers = append(a.eventsConsumers, c)
}

//CloseEventsConsumers closes events queues(streaming) and loggers(batch) in the last call
//for preventing losing events
func (a *AppConfig) CloseEventsConsumers() {
	for _, ec := range a.eventsConsumers {
		if err := ec.Close(); err != nil {
			logging.Errorf("[EventsConsumer] %v", err)
		}
	}
}

func loadGeoResolver() geo.Resolver {
	geoPath := viper.GetString("geo.maxmind_path")
	if viper.IsSet("geo.maxmind_path") {
		geoResolver, err := geo.CreateResolver(geoPath)
		if err != nil {
			logging.Warnf("❌ Failed to load MaxMind DB from %s: %v. Geo resolution won't be available", geoPath, err)
		} else {
			logging.Info("✅ Loaded MaxMind db:", geoPath)
			return geoResolver
		}
	} else {
		logging.Info("❌ Geo resolution won't be available as geo.maxmind_path is not set")
	}

	return &geo.DummyResolver{}
}
