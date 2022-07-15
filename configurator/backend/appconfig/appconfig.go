package appconfig

import (
	"io"
	"os"

	jcors "github.com/jitsucom/jitsu/server/cors"
	"github.com/jitsucom/jitsu/server/logging"
	"github.com/spf13/viper"
)

type AppConfig struct {
	Domain     string
	ServerName string
	Authority  string

	closeMe     []io.Closer
	lastCloseMe []io.Closer
}

var Instance *AppConfig

func setDefaultParams(containerized bool) {
	viper.SetDefault("jitsu.domain", "jitsu.com")
	viper.SetDefault("server.port", "7000")
	viper.SetDefault("server.self_hosted", true)
	viper.SetDefault("server.log.level", "info")
	viper.SetDefault("server.allowed_domains", []string{"localhost", jcors.AppTopLevelDomainTemplate})
	viper.SetDefault("ui.base_url", "/")

	if containerized {
		viper.SetDefault("server.log.path", "/home/configurator/data/logs")
	} else {
		viper.SetDefault("server.log.path", "./logs")
	}
}

func Init(containerized bool) error {
	setDefaultParams(containerized)

	var appConfig AppConfig
	serverName := viper.GetString("server.name")
	if serverName == "" {
		serverName, _ = os.Hostname()
	}
	if serverName == "" {
		serverName = "unnamed-server"
	}
	appConfig.Domain = viper.GetString("jitsu.domain")
	appConfig.ServerName = serverName
	var port = viper.GetString("server.port")
	appConfig.Authority = "0.0.0.0:" + port

	globalLoggerConfig := &logging.Config{
		FileName:    serverName + "-main",
		FileDir:     viper.GetString("server.log.path"),
		RotationMin: viper.GetInt64("server.log.rotation_min"),
		MaxBackups:  viper.GetInt("server.log.max_backups")}
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
	err := logging.InitGlobalLogger(globalLogsWriter, viper.GetString("server.log.level"))
	if err != nil {
		return err
	}

	logging.Info("*** Creating new AppConfig ***")
	if globalLoggerConfig.FileDir != "" {
		logging.Infof("Using server.log.path directory: %q", globalLoggerConfig.FileDir)
	}

	Instance = &appConfig
	return nil
}

func (a *AppConfig) ScheduleClosing(c interface{}) {
	if c, ok := c.(io.Closer); ok {
		a.closeMe = append(a.closeMe, c)
	}
}

func (a *AppConfig) Close() {
	for _, cl := range a.closeMe {
		if err := cl.Close(); err != nil {
			logging.Error(err)
		}
	}
}

//ScheduleLastClosing adds meta.Storage, coordinationService closers
func (a *AppConfig) ScheduleLastClosing(c io.Closer) {
	a.lastCloseMe = append(a.lastCloseMe, c)
}

//CloseLast closes meta.Storage, coordinationService closers in the last call
func (a *AppConfig) CloseLast() {
	for _, cl := range a.lastCloseMe {
		if err := cl.Close(); err != nil {
			logging.Error(err)
		}
	}
}
