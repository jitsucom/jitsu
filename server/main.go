package main

import (
	"context"
	"flag"
	"math/rand"
	"net/http"
	"os"
	"os/signal"
	"path"
	"path/filepath"
	"runtime/debug"
	"syscall"
	"time"

	"github.com/gin-gonic/gin/binding"
	"github.com/jitsucom/jitsu/server/appconfig"
	"github.com/jitsucom/jitsu/server/appstatus"
	"github.com/jitsucom/jitsu/server/caching"
	"github.com/jitsucom/jitsu/server/config"
	"github.com/jitsucom/jitsu/server/coordination"
	"github.com/jitsucom/jitsu/server/counters"
	"github.com/jitsucom/jitsu/server/destinations"
	"github.com/jitsucom/jitsu/server/enrichment"
	"github.com/jitsucom/jitsu/server/fallback"
	"github.com/jitsucom/jitsu/server/logfiles"
	"github.com/jitsucom/jitsu/server/logging"
	"github.com/jitsucom/jitsu/server/meta"
	"github.com/jitsucom/jitsu/server/metrics"
	"github.com/jitsucom/jitsu/server/middleware"
	"github.com/jitsucom/jitsu/server/notifications"
	"github.com/jitsucom/jitsu/server/routers"
	"github.com/jitsucom/jitsu/server/safego"
	"github.com/jitsucom/jitsu/server/scheduling"
	"github.com/jitsucom/jitsu/server/singer"
	"github.com/jitsucom/jitsu/server/sources"
	"github.com/jitsucom/jitsu/server/storages"
	"github.com/jitsucom/jitsu/server/synchronization"
	"github.com/jitsucom/jitsu/server/telemetry"
	"github.com/jitsucom/jitsu/server/users"
	"github.com/spf13/viper"
)

//some inner parameters
const (
	//incoming.tok=$token-$timestamp.log
	uploaderFileMask   = "incoming.tok=*-20*.log"
	uploaderLoadEveryS = 60
	//streaming-archive.dst=$destinationID-$timestamp.log
	streamArchiveFileMask = "streaming-archive*-20*.log"
	streamArchiveEveryS   = 60

	destinationsKey = "destinations"
	sourcesKey      = "sources"

	configNotFound = "! Custom eventnative.yaml wasn't provided\n                            " +
		"! Jitsu server will start, however it will be mostly useless\n                            " +
		"! Please make a custom config file, you can generated a config with https://cloud.jitsu.com.\n                            " +
		"! Configuration documentation: https://jitsu.com/docs/configuration\n                            " +
		"! Add config with `-cfg eventnative.yaml` parameter or put eventnative.yaml to <config_dir> and add mapping\n                            " +
		"! -v <config_dir>/:/home/eventnative/data/config if you're using official Docker image"
)

var (
	//configSource might be URL or file path to yaml configuration
	configSource     = flag.String("cfg", "", "config source")
	containerizedRun = flag.Bool("cr", false, "containerised run marker")
	dockerHubID      = flag.String("dhid", "", "ID of docker Hub")

	//ldflags
	commit  string
	tag     string
	builtAt string
)

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
	flag.Parse()

	//Setup seed for globalRand
	rand.Seed(time.Now().Unix())

	//Setup handlers binding for json parsing numbers into json.Number (not only in float64)
	binding.EnableDecoderUseNumber = true

	//Setup default timezone for time.Now() calls
	time.Local = time.UTC

	// Setup application directory as working directory
	setAppWorkDir()

	if err := config.Read(*configSource, *containerizedRun, configNotFound); err != nil {
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

	if err := appconfig.Init(*containerizedRun, *dockerHubID); err != nil {
		logging.Fatal(err)
	}

	if err := singer.Init(viper.GetString("singer-bridge.python"), viper.GetString("singer-bridge.venv_dir"),
		viper.GetBool("singer-bridge.install_taps"), appconfig.Instance.SingerLogsWriter); err != nil {
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
		time.Sleep(5 * time.Second)
		telemetry.Close()
		os.Exit(0)
	}()

	//Get logger configuration
	logEventPath := viper.GetString("log.path")
	// Create full path to logs directory if it is necessary
	logging.Infof("Create log.path directory: %q", logEventPath)
	if err := logging.EnsureDir(logEventPath); err != nil {
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
	if viper.IsSet("coordination") {
		configuration := viper.Sub("coordination.redis")
		if configuration != nil {
			host := configuration.GetString("host")
			port := configuration.GetInt("port")
			password := configuration.GetString("password")
			coordinationService, err = coordination.NewRedisService(ctx, appconfig.Instance.ServerName, host, port, password)
			if err != nil {
				logging.Fatal("Failed to initiate coordination service", err)
			}
		} else {
			logging.Warn("Currently coordination service uses only redis implementation")
		}
	}

	if coordinationService == nil {
		if viper.IsSet("synchronization_service") {
			logging.Warnf("'synchronization_service' configuration is DEPRECATED. For more details see https://jitsu.com/docs/other-features/scaling-eventnative")

			coordinationService, err = coordination.NewEtcdService(ctx, appconfig.Instance.ServerName, viper.GetString("synchronization_service.endpoint"), viper.GetUint("synchronization_service.connection_timeout_seconds"))
			telemetry.Coordination("etcd")
		} else {
			coordinationService, err = coordination.NewService(ctx, appconfig.Instance.ServerName, viper.Sub("coordination"))
		}
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

	// ** Retrospective users recognition
	var globalRecognitionConfiguration *storages.UsersRecognition
	if viper.IsSet("users_recognition") {
		globalRecognitionConfiguration = &storages.UsersRecognition{
			Enabled:         viper.GetBool("users_recognition.enabled"),
			AnonymousIDNode: viper.GetString("users_recognition.anonymous_id_node"),
			UserIDNode:      viper.GetString("users_recognition.user_id_node"),
		}

		err := globalRecognitionConfiguration.Validate()
		if err != nil {
			logging.Fatalf("Invalid global users recognition configuration: %v", err)
		}

	} else {
		logging.Info("Global users recognition isn't configured")
	}

	maxColumns := viper.GetInt("server.max_columns")
	logging.Infof("Limit server.max_columns is %d", maxColumns)
	destinationsFactory := storages.NewFactory(ctx, logEventPath, coordinationService, eventsCache, loggerFactory, globalRecognitionConfiguration, maxColumns)

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
	sourceService, err := sources.NewService(ctx, viper.Sub(sourcesKey), viper.GetString(sourcesKey), destinationsService, metaStorage, cronScheduler)
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

	router := routers.SetupRouter(adminToken, metaStorage, destinationsService, sourceService, taskService, usersRecognitionService, fallbackService,
		coordinationService, eventsCache)

	telemetry.ServerStart(*dockerHubID)
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
