package main

import (
	"bytes"
	"context"
	"flag"
	"github.com/gin-gonic/gin"
	"github.com/ksensehq/eventnative/appconfig"
	"github.com/ksensehq/eventnative/appstatus"
	"github.com/ksensehq/eventnative/destinations"
	"github.com/ksensehq/eventnative/events"
	"github.com/ksensehq/eventnative/handlers"
	"github.com/ksensehq/eventnative/logfiles"
	"github.com/ksensehq/eventnative/logging"
	"github.com/ksensehq/eventnative/middleware"
	"github.com/ksensehq/eventnative/storages"
	"github.com/ksensehq/eventnative/telemetry"
	"math/rand"
	"net/http"
	"os"
	"os/signal"
	"strings"
	"syscall"
	"time"

	"github.com/spf13/viper"
)

//some inner parameters
const (
	//$serverName-event-$token-$timestamp.log
	uploaderFileMask   = "-event-*-20*.log"
	uploaderBatchSize  = 50
	uploaderLoadEveryS = 60

	destinationsKey = "destinations"
)

var (
	configFilePath   = flag.String("cfg", "", "config file path")
	containerizedRun = flag.Bool("cr", false, "containerised run marker")

	//ldflags
	commit  string
	tag     string
	builtAt string
)

func readInViperConfig() error {
	flag.Parse()
	viper.AutomaticEnv()
	//support OS env variables as lower case and dot divided variables e.g. SERVER_PORT as server.port
	viper.SetEnvKeyReplacer(strings.NewReplacer(".", "_"))
	//custom config
	viper.SetConfigFile(*configFilePath)
	if err := viper.ReadInConfig(); err != nil {
		//failfast for running service from source (not containerised) and with wrong config
		if viper.ConfigFileUsed() != "" && !*containerizedRun {
			return err
		} else {
			logging.Warn("Custom eventnative.yaml wasn't provided")
		}
	}
	return nil
}

//go:generate easyjson -all useragent/resolver.go telemetry/req_factory.go telemetry/models.go
func main() {
	// Setup seed for globalRand
	rand.Seed(time.Now().Unix())

	//Setup default timezone for time.Now() calls
	time.Local = time.UTC

	if err := readInViperConfig(); err != nil {
		logging.Fatal("Error while reading application config: ", err)
	}

	if err := appconfig.Init(); err != nil {
		logging.Fatal(err)
	}

	telemetry.Init(commit, tag, builtAt, viper.GetBool("server.telemetry.disabled.usage"))

	//listen to shutdown signal to free up all resources
	ctx, cancel := context.WithCancel(context.Background())
	c := make(chan os.Signal, 1)
	signal.Notify(c, syscall.SIGTERM, syscall.SIGINT, syscall.SIGKILL, syscall.SIGHUP)
	go func() {
		<-c
		logging.Info("* Service is shutting down.. *")
		telemetry.ServerStop()
		appstatus.Instance.Idle = true
		cancel()
		appconfig.Instance.Close()
		time.Sleep(3 * time.Second)
		os.Exit(0)
	}()

	destinationsViper := viper.Sub(destinationsKey)
	destinationsSource := viper.GetString(destinationsKey)

	//override with config from os env
	jsonConfig := viper.GetString("destinations_json")
	if jsonConfig != "" && jsonConfig != "{}" {
		envJsonViper := viper.New()
		envJsonViper.SetConfigType("json")
		if err := envJsonViper.ReadConfig(bytes.NewBufferString(jsonConfig)); err != nil {
			logging.Error("Error reading/parsing json config from DESTINATIONS_JSON", err)
		} else {
			destinationsViper = envJsonViper.Sub(destinationsKey)
			destinationsSource = envJsonViper.GetString(destinationsKey)
		}
	}

	monitorKeeper, err := storages.NewMonitorKeeper(
		viper.GetString("synchronization_service.type"),
		viper.GetString("synchronization_service.endpoint"),
		viper.GetUint("synchronization_service.connection_timeout_seconds"))
	if err != nil {
		logging.Fatal("Failed to initiate monitor keeper ", err)
	}

	//Get event logger path
	logEventPath := viper.GetString("log.path")

	//Create event destinations:
	destinationsService, err := destinations.NewService(ctx, destinationsViper, destinationsSource, logEventPath, monitorKeeper, storages.Create)
	if err != nil {
		logging.Fatal(err)
	}
	appconfig.Instance.ScheduleClosing(destinationsService)

	//Uploader must read event logger directory
	uploader, err := logfiles.NewUploader(logEventPath, appconfig.Instance.ServerName+uploaderFileMask, uploaderBatchSize, uploaderLoadEveryS, destinationsService)
	if err != nil {
		logging.Fatal("Error while creating file uploader", err)
	}
	uploader.Start()

	adminToken := viper.GetString("server.admin_token")
	router := SetupRouter(destinationsService, adminToken)

	telemetry.ServerStart()
	logging.Info("Started server: " + appconfig.Instance.Authority)
	server := &http.Server{
		Addr:              appconfig.Instance.Authority,
		Handler:           middleware.Cors(router),
		ReadTimeout:       time.Second * 60,
		ReadHeaderTimeout: time.Second * 60,
		IdleTimeout:       time.Second * 65,
	}
	logging.Fatal(server.ListenAndServe())
}

func SetupRouter(destinations *destinations.Service, adminToken string) *gin.Engine {
	gin.SetMode(gin.ReleaseMode)

	router := gin.New() //gin.Default()

	router.GET("/", handlers.NewRedirectHandler("/p/welcome.html").Handler)
	router.GET("/ping", func(c *gin.Context) {
		c.String(http.StatusOK, "pong")
	})

	publicUrl := viper.GetString("server.public_url")

	htmlHandler := handlers.NewPageHandler(viper.GetString("server.static_files_dir"), publicUrl, viper.GetBool("server.disable_welcome_page"))
	router.GET("/p/:filename", htmlHandler.Handler)

	staticHandler := handlers.NewStaticHandler(viper.GetString("server.static_files_dir"), publicUrl)
	router.GET("/s/:filename", staticHandler.Handler)
	router.GET("/t/:filename", staticHandler.Handler)

	jsEventHandler := handlers.NewEventHandler(destinations, events.NewJsPreprocessor()).Handler
	apiEventHandler := handlers.NewEventHandler(destinations, events.NewApiPreprocessor()).Handler

	adminTokenMiddleware := middleware.AdminToken{Token: adminToken}
	apiV1 := router.Group("/api/v1")
	{
		apiV1.POST("/event", middleware.TokenAuth(jsEventHandler, appconfig.Instance.AuthorizationService.GetClientOrigins, ""))
		apiV1.POST("/s2s/event", middleware.TokenAuth(apiEventHandler, appconfig.Instance.AuthorizationService.GetServerOrigins, "The token isn't a server token. Please use s2s integration token\n"))
		apiV1.POST("/destinations/test", adminTokenMiddleware.AdminAuth(handlers.DestinationHandler, "Admin token does not match"))
	}

	return router
}
