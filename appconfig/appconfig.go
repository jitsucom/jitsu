package appconfig

import (
	"fmt"
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

	GeoResolver geo.Resolver
	UaResolver  useragent.Resolver

	AuthorizationService *authorization.Service
	QueryLogsWriter      *io.Writer

	closeMe []io.Closer
}

var Instance *AppConfig

func setDefaultParams() {
	viper.SetDefault("server.name", "unnamed-server")
	viper.SetDefault("server.port", "8001")
	viper.SetDefault("server.static_files_dir", "./web")
	viper.SetDefault("server.auth_reload_sec", 30)
	viper.SetDefault("server.destinations_reload_sec", 40)
	viper.SetDefault("server.sync_tasks.pool.size", 500)
	viper.SetDefault("server.disable_version_reminder", false)
	viper.SetDefault("geo.maxmind_path", "/home/eventnative/app/res/")
	viper.SetDefault("log.path", "/home/eventnative/logs/events")
	viper.SetDefault("log.fallback", "/home/eventnative/logs/fallback")
	viper.SetDefault("log.show_in_server", false)
	viper.SetDefault("log.rotation_min", 5)
	viper.SetDefault("synchronization_service.connection_timeout_seconds", 20)
	viper.SetDefault("sql_debug_log.rotation_min", "5")
}

func Init() error {
	setDefaultParams()

	serverName := viper.GetString("server.name")
	globalLoggerConfig := logging.Config{
		LoggerName:  "main",
		ServerName:  serverName,
		FileDir:     viper.GetString("server.log.path"),
		RotationMin: viper.GetInt64("server.log.rotation_min"),
		MaxBackups:  viper.GetInt("server.log.max_backups")}
	if err := globalLoggerConfig.Validate(); err != nil {
		return fmt.Errorf("Error while creating global logger: %v", err)
	}

	//Global logger writes logs and sends system error notifications
	//
	//   configured file logger            no file logger configured
	//     /             \                            |
	// os.Stdout      FileWriter                  os.Stdout
	var globalLogsWriter io.Writer
	if globalLoggerConfig.FileDir != "" {
		fileWriter := logging.NewRollingWriter(globalLoggerConfig)
		globalLogsWriter = logging.Dual{
			FileWriter: fileWriter,
			Stdout:     os.Stdout,
		}
	} else {
		globalLogsWriter = os.Stdout
	}
	err := logging.InitGlobalLogger(globalLogsWriter)
	if err != nil {
		return err
	}

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

	queryLogsWriter, err := InitQueryWriter(globalLogsWriter)
	if err != nil {
		return err
	}
	appConfig.QueryLogsWriter = &queryLogsWriter

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

func InitQueryWriter(globalLogsWriter io.Writer) (io.Writer, error) {
	var queryLogsWriter io.Writer
	if viper.IsSet("sql_debug_log.path") {
		if viper.GetString("sql_debug_log.path") != "global" {
			queryLoggerConfig := logging.Config{
				LoggerName:  "query",
				ServerName:  viper.GetString("server.name"),
				FileDir:     viper.GetString("sql_debug_log.path"),
				RotationMin: viper.GetInt64("sql_debug_log.rotation_min"),
				MaxBackups:  viper.GetInt("sql_debug_log.max_backups")}

			writer := logging.NewRollingWriter(queryLoggerConfig)
			queryLogsWriter = writer
		} else {
			queryLogsWriter = globalLogsWriter
		}
	}
	return queryLogsWriter, nil
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
