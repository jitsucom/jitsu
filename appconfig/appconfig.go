package appconfig

import (
	"github.com/jitsucom/eventnative/authorization"
	"github.com/jitsucom/eventnative/geo"
	"github.com/jitsucom/eventnative/logging"
	"github.com/jitsucom/eventnative/useragent"
	"github.com/spf13/viper"
	"io"
	"os"
)

type AppConfig struct {
	ServerName string
	Authority  string

	GeoResolver          geo.Resolver
	UaResolver           useragent.Resolver
	AuthorizationService *authorization.Service
	DDLLogsWriter        io.Writer
	QueryLogsWriter      io.Writer

	closeMe []io.Closer
}

var (
	Instance     *AppConfig
	RawVersion   string
	MajorVersion string
	MinorVersion string
	Beta         bool
)

func setDefaultParams() {
	viper.SetDefault("server.name", "unnamed-server")
	viper.SetDefault("server.port", "8001")
	viper.SetDefault("server.static_files_dir", "./web")
	viper.SetDefault("server.auth_reload_sec", 30)
	viper.SetDefault("server.destinations_reload_sec", 40)
	viper.SetDefault("server.sync_tasks.pool.size", 500)
	viper.SetDefault("server.disable_version_reminder", false)
	viper.SetDefault("server.cache.events.size", 100)
	viper.SetDefault("geo.maxmind_path", "/home/eventnative/app/res/")
	viper.SetDefault("log.path", "/home/eventnative/logs/events")
	viper.SetDefault("log.show_in_server", false)
	viper.SetDefault("log.rotation_min", 5)
	viper.SetDefault("synchronization_service.connection_timeout_seconds", 20)
	viper.SetDefault("sql_debug_log.queries.rotation_min", "1440")
	viper.SetDefault("sql_debug_log.ddl.rotation_min", "1440")
	viper.SetDefault("users_recognition.enabled", false)
	viper.SetDefault("users_recognition.anonymous_id_node", "/eventn_ctx/user/anonymous_id")
	viper.SetDefault("users_recognition.user_id_node", "/eventn_ctx/user/internal_id")
}

func Init() error {
	setDefaultParams()

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
	if globalLoggerConfig.FileDir != "" {
		fileWriter := logging.NewRollingWriter(globalLoggerConfig)
		logging.GlobalLogsWriter = logging.Dual{
			FileWriter: fileWriter,
			Stdout:     os.Stdout,
		}
	} else {
		logging.GlobalLogsWriter = os.Stdout
	}
	err := logging.InitGlobalLogger(logging.GlobalLogsWriter)
	if err != nil {
		return err
	}

	logWelcomeBanner(RawVersion)

	logging.Info("*** Creating new AppConfig ***")
	logging.Info("Server Name:", serverName)
	publicUrl := viper.GetString("server.public_url")
	if publicUrl == "" {
		logging.Warn("Server public url: will be taken from Host header")
	} else {
		logging.Info("Server public url:", publicUrl)
	}

	var appConfig AppConfig
	appConfig.ServerName = serverName

	// SQL DDL debug writer
	if viper.IsSet("sql_debug_log.ddl.path") {
		appConfig.DDLLogsWriter = appConfig.getSqlWriter(viper.Sub("sql_debug_log.ddl"), serverName, "ddl-debug")
	}
	// SQL queries debug writer
	if viper.IsSet("sql_debug_log.queries.path") {
		appConfig.QueryLogsWriter = appConfig.getSqlWriter(viper.Sub("sql_debug_log.queries"), serverName, "sql-debug")
	}

	port := viper.GetString("port")
	if port == "" {
		port = viper.GetString("server.port")
	}
	appConfig.Authority = "0.0.0.0:" + port

	geoResolver, err := geo.CreateResolver(viper.GetString("geo.maxmind_path"))
	if err != nil {
		logging.Warn("Run without geo resolver:", err)
	}

	authService, err := authorization.NewService()
	if err != nil {
		return err
	}

	appConfig.AuthorizationService = authService
	appConfig.GeoResolver = geoResolver
	appConfig.UaResolver = useragent.NewResolver()

	Instance = &appConfig
	return nil
}

func (a *AppConfig) getSqlWriter(sqlLoggerViper *viper.Viper, serverName string, logType string) io.Writer {
	if sqlLoggerViper.GetString("path") != "global" {
		return logging.NewRollingWriter(logging.Config{
			FileName:    serverName + "-" + logType,
			FileDir:     sqlLoggerViper.GetString("path"),
			RotationMin: sqlLoggerViper.GetInt64("rotation_min"),
			MaxBackups:  sqlLoggerViper.GetInt("max_backups")})
	} else {
		return logging.GlobalLogsWriter
	}
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
