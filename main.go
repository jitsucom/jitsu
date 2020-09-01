package main

import (
	"bytes"
	"context"
	"flag"
	"github.com/gin-gonic/gin"
	"github.com/ksensehq/eventnative/appconfig"
	"github.com/ksensehq/eventnative/appstatus"
	"github.com/ksensehq/eventnative/events"
	"github.com/ksensehq/eventnative/handlers"
	"github.com/ksensehq/eventnative/logfiles"
	"github.com/ksensehq/eventnative/logging"
	"github.com/ksensehq/eventnative/middleware"
	"github.com/ksensehq/eventnative/storages"
	"log"
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
)

var (
	configFilePath   = flag.String("cfg", "", "config file path")
	containerizedRun = flag.Bool("cr", false, "containerised run marker")
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
			log.Println("Custom eventnative.yaml wasn't provided")
		}
	}
	return nil
}

//go:generate easyjson -all useragent/resolver.go
func main() {
	// Setup seed for globalRand
	rand.Seed(time.Now().Unix())

	//Setup default timezone for time.Now() calls
	time.Local = time.UTC

	if err := readInViperConfig(); err != nil {
		log.Fatal("Error while reading application config: ", err)
	}

	if err := appconfig.Init(); err != nil {
		log.Fatal(err)
	}

	//listen to shutdown signal to free up all resources
	ctx, cancel := context.WithCancel(context.Background())
	c := make(chan os.Signal, 1)
	signal.Notify(c, syscall.SIGTERM, syscall.SIGINT, syscall.SIGKILL, syscall.SIGHUP)
	go func() {
		<-c
		appstatus.Instance.Idle = true
		cancel()
		appconfig.Instance.Close()
		time.Sleep(3 * time.Second)
		os.Exit(0)
	}()

	destinationsViper := viper.Sub("destinations")

	//override with config from os env
	jsonConfig := viper.GetString("destinations_json")
	if jsonConfig != "" && jsonConfig != "{}" {
		envJsonViper := viper.New()
		envJsonViper.SetConfigType("json")
		if err := envJsonViper.ReadConfig(bytes.NewBufferString(jsonConfig)); err != nil {
			log.Println("Error reading/parsing json config from DESTINATIONS_JSON", err)
		} else {
			destinationsViper = envJsonViper.Sub("destinations")
		}
	}

	//Get event logger path
	logEventPath := viper.GetString("log.path")

	//logger consumers per token
	loggingConsumers := map[string]events.Consumer{}
	for token := range appconfig.Instance.AuthorizedTokens {
		eventLogWriter, err := logging.NewWriter(logging.Config{
			LoggerName:  "event-" + token,
			ServerName:  appconfig.Instance.ServerName,
			FileDir:     logEventPath,
			RotationMin: viper.GetInt64("log.rotation_min")})
		if err != nil {
			log.Fatal(err)
		}
		logger := events.NewAsyncLogger(eventLogWriter, viper.GetBool("log.show_in_server"))
		loggingConsumers[token] = logger
		appconfig.Instance.ScheduleClosing(logger)
	}

	//Create event destinations:
	//- batch mode (events.Storage)
	//- streaming mode (events.Consumer)
	//per token
	batchStoragesByToken, streamingConsumersByToken := storages.Create(ctx, destinationsViper, logEventPath)

	//Schedule storages resource releasing
	for _, eStorages := range batchStoragesByToken {
		for _, es := range eStorages {
			appconfig.Instance.ScheduleClosing(es)
		}
	}
	//Schedule consumers resource releasing
	for _, eConsumers := range streamingConsumersByToken {
		for _, ec := range eConsumers {
			appconfig.Instance.ScheduleClosing(ec)
		}
	}

	//merge logger consumers with storage consumers: Skip loggers which don't have batches storages (because we don't need to write log files for streaming storages)
	for token, loggingConsumer := range loggingConsumers {
		if _, ok := batchStoragesByToken[token]; !ok {
			continue
		}

		consumers, ok := streamingConsumersByToken[token]
		if !ok {
			consumers = []events.Consumer{}
		}
		consumers = append(consumers, loggingConsumer)
		streamingConsumersByToken[token] = consumers
	}

	//Uploader must read event logger directory
	uploader, err := logfiles.NewUploader(logEventPath, appconfig.Instance.ServerName+uploaderFileMask, uploaderBatchSize, uploaderLoadEveryS, batchStoragesByToken)
	if err != nil {
		log.Fatal("Error while creating file uploader", err)
	}
	uploader.Start()

	router := SetupRouter(streamingConsumersByToken)

	log.Println("Started server: " + appconfig.Instance.Authority)
	server := &http.Server{
		Addr:              appconfig.Instance.Authority,
		Handler:           middleware.Cors(router),
		ReadTimeout:       time.Second * 60,
		ReadHeaderTimeout: time.Second * 60,
		IdleTimeout:       time.Second * 65,
	}
	log.Fatal(server.ListenAndServe())
}

func SetupRouter(tokenizedEventConsumers map[string][]events.Consumer) *gin.Engine {
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

	c2sEventHandler := handlers.NewEventHandler(tokenizedEventConsumers, events.NewC2SPreprocessor()).Handler
	s2sEventHandler := handlers.NewEventHandler(tokenizedEventConsumers, events.NewS2SPreprocessor()).Handler
	apiV1 := router.Group("/api/v1")
	{
		apiV1.POST("/event", middleware.TokenAuth(middleware.AccessControl(c2sEventHandler, appconfig.Instance.C2STokens, "")))
		apiV1.POST("/s2s/event", middleware.TokenAuth(middleware.AccessControl(s2sEventHandler, appconfig.Instance.S2STokens, "The token isn't a server token. Please use s2s integration token\n")))
	}

	return router
}
