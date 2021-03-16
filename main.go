package main

import (
	"bytes"
	"context"
	"flag"
	"fmt"
	"math/rand"
	"net/http"
	"os"
	"os/signal"
	"path"
	"path/filepath"
	"runtime/debug"
	"strings"
	"syscall"
	"time"

	"github.com/gin-gonic/gin/binding"
	"github.com/jitsucom/eventnative/appconfig"
	"github.com/jitsucom/eventnative/appstatus"
	"github.com/jitsucom/eventnative/caching"
	"github.com/jitsucom/eventnative/coordination"
	"github.com/jitsucom/eventnative/counters"
	"github.com/jitsucom/eventnative/destinations"
	"github.com/jitsucom/eventnative/enrichment"
	"github.com/jitsucom/eventnative/events"
	"github.com/jitsucom/eventnative/fallback"
	"github.com/jitsucom/eventnative/logfiles"
	"github.com/jitsucom/eventnative/logging"
	"github.com/jitsucom/eventnative/meta"
	"github.com/jitsucom/eventnative/metrics"
	"github.com/jitsucom/eventnative/middleware"
	"github.com/jitsucom/eventnative/notifications"
	"github.com/jitsucom/eventnative/resources"
	"github.com/jitsucom/eventnative/routers"
	"github.com/jitsucom/eventnative/safego"
	"github.com/jitsucom/eventnative/scheduling"
	"github.com/jitsucom/eventnative/singer"
	"github.com/jitsucom/eventnative/sources"
	"github.com/jitsucom/eventnative/storages"
	"github.com/jitsucom/eventnative/synchronization"
	"github.com/jitsucom/eventnative/telemetry"
	"github.com/jitsucom/eventnative/users"
	"github.com/spf13/viper"
)

//some inner parameters
const (
	//incoming.tok=$token-$timestamp.log
	uploaderFileMask   = "incoming.tok=*-20*.log"
	uploaderLoadEveryS = 60
	//streaming-archive.dst=$destinationId-$timestamp.log
	streamArchiveFileMask = "streaming-archive*-20*.log"
	streamArchiveEveryS   = 60

	destinationsKey = "destinations"
	sourcesKey      = "sources"

	configNotFound = "! Custom eventnative.yaml wasn't provided\n                            " +
		"! EventNative will start, however it will be mostly useless\n                            " +
		"! Please make a custom config file, you can generated a config with https://app.jitsu.com.\n                            " +
		"! Configuration documentation: https://docs.eventnative.org/configuration-1/configuration\n                            " +
		"! Add config with `-cfg eventnative.yaml` parameter or put eventnative.yaml to <config_dir> and add mapping\n                            " +
		"! -v <config_dir>/:/home/eventnative/app/res/ if you're using official Docker image"
)

var (
	//configSource might be URL or file path to yaml configuration
	configSource     = flag.String("cfg", "", "config source")
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
	configSourceStr := *configSource

	//overridden configuration from ENV
	overriddenConfigLocation := viper.GetString("config_location")
	if overriddenConfigLocation != "" {
		configSourceStr = overriddenConfigLocation
	}

	var payload *resources.ResponsePayload
	var err error
	if strings.HasPrefix(configSourceStr, "http://") || strings.HasPrefix(configSourceStr, "https://") {
		payload, err = resources.LoadFromHttp(configSourceStr, "")
	} else if strings.HasPrefix(configSourceStr, "{") && strings.HasSuffix(configSourceStr, "}") {
		jsonContentType := resources.JsonContentType
		payload = &resources.ResponsePayload{Content: []byte(configSourceStr), ContentType: &jsonContentType}
	} else if configSourceStr != "" {
		payload, err = resources.LoadFromFile(configSourceStr, "")
	}

	if err != nil {
		return handleConfigErr(err)
	}

	if payload != nil && payload.ContentType != nil {
		viper.SetConfigType(string(*payload.ContentType))
	} else {
		//default content type
		viper.SetConfigType("json")
	}

	if payload != nil {
		err = viper.ReadConfig(bytes.NewBuffer(payload.Content))
		if err != nil {
			errWithContext := fmt.Errorf("Error reading/parsing config from %s: %v", configSourceStr, err)
			return handleConfigErr(errWithContext)
		}
	}

	return nil
}

//return err only if application can't start without config
//otherwise log error and return nil
func handleConfigErr(err error) error {
	//failfast for running service from source (not containerised) and with wrong config
	if !*containerizedRun {
		return err
	}

	logging.ConfigErr = err.Error()
	logging.ConfigWarn = configNotFound
	return nil
}

func setAppWorkDir() {
	application, err := os.Executable()
	if err != nil {
		logging.Errorf("Cannot get executable information: %v", err)
	}

	directory := filepath.Dir(application)

	if err = os.Chdir(directory); err != nil {
		logging.Errorf("Cannot setup working directory %v: %v", directory, err)
	}
}

func main() {
	//Setup seed for globalRand
	rand.Seed(time.Now().Unix())

	//Setup handlers binding for json parsing numbers into json.Number (not only in float64)
	binding.EnableDecoderUseNumber = true

	//Setup default timezone for time.Now() calls
	time.Local = time.UTC

	// Setup application directory as working directory
	setAppWorkDir()

	if err := readInViperConfig(); err != nil {
		logging.Fatal("Error while reading application config:", err)
	}

	//parse EN version
	parsed := appconfig.VersionRegex.FindStringSubmatch(tag)
	if len(parsed) == 4 {
		appconfig.RawVersion = parsed[0]
		appconfig.MajorVersion = parsed[1]
		appconfig.MinorVersion = parsed[3]
		appconfig.Beta = parsed[2] == "beta"
	}

	if err := appconfig.Init(*containerizedRun); err != nil {
		logging.Fatal(err)
	}

	if err := singer.Init(viper.GetString("singer-bridge.python"), viper.GetString("singer-bridge.venv_dir"), appconfig.Instance.SingerLogsWriter); err != nil {
		logging.Fatal(err)
	}

	enrichment.InitDefault()

	safego.GlobalRecoverHandler = func(value interface{}) {
		logging.Error("panic")
		logging.Error(value)
		logging.Error(string(debug.Stack()))
		notifications.SystemErrorf("Panic:\n%s\n%s", value, string(debug.Stack()))
	}

	telemetry.InitFromViper(notifications.ServiceName, commit, tag, builtAt)
	metrics.Init(viper.GetBool("server.metrics.prometheus.enabled"))

	slackNotificationsWebHook := viper.GetString("notifications.slack.url")
	if slackNotificationsWebHook != "" {
		notifications.Init(notifications.ServiceName, slackNotificationsWebHook, appconfig.Instance.ServerName, logging.Errorf)
	}

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
		telemetry.Flush()
		notifications.Close()
		time.Sleep(3 * time.Second)
		telemetry.Close()
		os.Exit(0)
	}()

	//Get logger configuration
	logEventPath := viper.GetString("log.path")
	// Create full path to logs directory if it is necessary
	logging.Infof("Create log.path directory: %q", logEventPath)
	if err := os.MkdirAll(logEventPath, 0644); err != nil {
		logging.Fatalf("log.path %q cannot be created!", logEventPath)
	}
	//check if log.path is writable
	if !logging.IsDirWritable(logEventPath) {
		logging.Fatal("log.path:", logEventPath, "must be writable! Since EventNative docker user and owner of mounted dir are different: Please use 'chmod 777 your_mount_dir'")
	}
	logRotationMin := viper.GetInt64("log.rotation_min")

	loggerFactory := logging.NewFactory(logEventPath, logRotationMin, viper.GetBool("log.show_in_server"),
		appconfig.Instance.GlobalDDLLogsWriter, appconfig.Instance.GlobalQueryLogsWriter)

	//TODO remove deprecated someday
	//coordination service
	var coordinationService coordination.Service
	var err error
	if viper.IsSet("synchronization_service") {
		logging.Warnf("'synchronization_service' configuration is DEPRECATED. For more details see https://jitsu.com/docs/other-features/scaling-eventnative")

		coordinationService, err = coordination.NewEtcdService(ctx, appconfig.Instance.ServerName, viper.GetString("synchronization_service.endpoint"), viper.GetUint("synchronization_service.connection_timeout_seconds"))
	} else {
		coordinationService, err = coordination.NewService(ctx, appconfig.Instance.ServerName, viper.Sub("coordination"))
	}

	if err != nil {
		logging.Fatal("Failed to initiate coordination service", err)
	}

	// ** Destinations **

	//meta storage
	metaStorage, err := meta.NewStorage(viper.Sub("meta.storage"))
	if err != nil {
		logging.Fatalf("Error initializing meta storage: %v", err)
	}
	//close after all for saving last task statuses
	defer metaStorage.Close()

	//events counters
	counters.InitEvents(metaStorage)

	//events cache
	eventsCacheSize := viper.GetInt("server.cache.events.size")
	eventsCache := caching.NewEventsCache(metaStorage, eventsCacheSize)
	appconfig.Instance.ScheduleClosing(eventsCache)

	//Deprecated
	inMemoryEventsCache := events.NewCache(eventsCacheSize)
	appconfig.Instance.ScheduleClosing(inMemoryEventsCache)

	// ** Retrospective users recognition
	var globalRecognitionConfiguration *storages.UsersRecognition
	if viper.IsSet("users_recognition") {
		globalRecognitionConfiguration = &storages.UsersRecognition{
			Enabled:         viper.GetBool("users_recognition.enabled"),
			AnonymousIdNode: viper.GetString("users_recognition.anonymous_id_node"),
			UserIdNode:      viper.GetString("users_recognition.user_id_node"),
		}

		err := globalRecognitionConfiguration.Validate()
		if err != nil {
			logging.Fatalf("Invalid global users recognition configuration: %v", err)
		}

	} else {
		logging.Warnf("Global users recognition isn't configured")
	}

	destinationsFactory := storages.NewFactory(ctx, logEventPath, coordinationService, eventsCache, loggerFactory, globalRecognitionConfiguration)

	//Create event destinations
	destinationsService, err := destinations.NewService(viper.Sub(destinationsKey), viper.GetString(destinationsKey), destinationsFactory, loggerFactory)
	if err != nil {
		logging.Fatal(err)
	}
	appconfig.Instance.ScheduleClosing(destinationsService)

	usersRecognitionService, err := users.NewRecognitionService(metaStorage, destinationsService, globalRecognitionConfiguration, logEventPath)
	if err != nil {
		logging.Fatal(err)
	}
	appconfig.Instance.ScheduleClosing(usersRecognitionService)

	// ** Sources **

	//Create source&collection sync scheduler
	cronScheduler := scheduling.NewCronScheduler()
	appconfig.Instance.ScheduleClosing(cronScheduler)

	//Create sources
	sourceService, err := sources.NewService(ctx, viper.Sub(sourcesKey), destinationsService, metaStorage, cronScheduler)
	if err != nil {
		logging.Fatal("Error creating sources service:", err)
	}
	appconfig.Instance.ScheduleClosing(sourceService)

	//Create sync task service
	taskService := synchronization.NewTaskService(sourceService, destinationsService, metaStorage, coordinationService)

	//Start cron scheduler
	if taskService.IsConfigured() {
		cronScheduler.Start(taskService.ScheduleSyncFunc)
	}

	//sources sync tasks pool size
	poolSize := viper.GetInt("server.sync_tasks.pool.size")

	//Create task executor
	taskExecutor, err := synchronization.NewTaskExecutor(poolSize, sourceService, destinationsService, metaStorage, coordinationService)
	if err != nil {
		logging.Fatal("Error creating sources sync task executor:", err)
	}
	appconfig.Instance.ScheduleClosing(taskExecutor)

	//Uploader must read event logger directory
	uploader, err := logfiles.NewUploader(logEventPath, uploaderFileMask, uploaderLoadEveryS, destinationsService)
	if err != nil {
		logging.Fatal("Error while creating file uploader", err)
	}
	uploader.Start()

	//Streaming events archiver
	periodicArchiver := logfiles.NewPeriodicArchiver(streamArchiveFileMask, path.Join(logEventPath, logging.ArchiveDir), time.Duration(streamArchiveEveryS)*time.Second)
	appconfig.Instance.ScheduleClosing(periodicArchiver)

	adminToken := viper.GetString("server.admin_token")

	fallbackService, err := fallback.NewService(logEventPath, destinationsService)
	if err != nil {
		logging.Fatal("Error creating fallback service:", err)
	}

	//version reminder banner in logs
	if tag != "" && !viper.GetBool("server.disable_version_reminder") {
		vn := appconfig.NewVersionReminder(ctx)
		vn.Start()
		appconfig.Instance.ScheduleClosing(vn)
	}

	router := routers.SetupRouter(adminToken, destinationsService, sourceService, taskService, usersRecognitionService, fallbackService,
		coordinationService, eventsCache, inMemoryEventsCache)

	telemetry.ServerStart()
	notifications.ServerStart()
	logging.Info("Started server: " + appconfig.Instance.Authority)
	server := &http.Server{
		Addr:              appconfig.Instance.Authority,
		Handler:           middleware.Cors(router, appconfig.Instance.AuthorizationService.GetClientOrigins),
		ReadTimeout:       time.Second * 60,
		ReadHeaderTimeout: time.Second * 60,
		IdleTimeout:       time.Second * 65,
	}
	logging.Fatal(server.ListenAndServe())
}
