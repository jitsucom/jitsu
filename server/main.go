package main

import (
	"context"
	"errors"
	"flag"
	"github.com/jitsucom/jitsu/server/schema"
	"github.com/jitsucom/jitsu/server/system"
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

	environment := os.Getenv("ENVIRONMENT")
	if environment != "" {
		dockerHubID = &environment
	}

	if err := appconfig.Init(*containerizedRun, *dockerHubID); err != nil {
		logging.Fatal(err)
	}

	if err := singer.Init(viper.GetString("singer-bridge.python"), viper.GetString("singer-bridge.venv_dir"),
		viper.GetBool("singer-bridge.install_taps"), appconfig.Instance.SingerLogsWriter); err != nil {
		logging.Fatal(err)
	}

	enrichment.InitDefault(
		viper.GetString("server.fields_configuration.src_source_ip"),
		viper.GetString("server.fields_configuration.dst_source_ip"),
		viper.GetString("server.fields_configuration.src_ua"),
		viper.GetString("server.fields_configuration.dst_ua"),
	)

	safego.GlobalRecoverHandler = func(value interface{}) {
		logging.Error("panic")
		logging.Error(value)
		logging.Error(string(debug.Stack()))
		notifications.SystemErrorf("Panic:\n%s\n%s", value, string(debug.Stack()))
	}

	telemetry.InitFromViper(notifications.ServiceName, commit, tag, builtAt, *dockerHubID)
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
		logging.Info("🤖 * Server is shutting down.. *")
		telemetry.ServerStop()
		appstatus.Instance.Idle = true
		cancel()
		appconfig.Instance.Close()
		telemetry.Flush()
		notifications.Close()
		time.Sleep(5 * time.Second)
		telemetry.Close()
		//we should close it in the end
		appconfig.Instance.CloseEventsConsumers()
		os.Exit(0)
	}()

	//Get logger configuration
	logEventPath := viper.GetString("log.path")
	// Create full path to logs directory if it is necessary
	logging.Infof("📂 Create log.path directory: %q", logEventPath)
	if err := logging.EnsureDir(logEventPath); err != nil {
		logging.Fatalf("log.path %q cannot be created!", logEventPath)
	}

	//check if log.path is writable
	if !logging.IsDirWritable(logEventPath) {
		logging.Fatal("log.path:", logEventPath, "must be writable! Since eventnative docker user and owner of mounted dir are different: Please use 'chmod 777 your_mount_dir'")
	}
	logRotationMin := viper.GetInt64("log.rotation_min")

	loggerFactory := logging.NewFactory(logEventPath, logRotationMin, viper.GetBool("log.show_in_server"),
		appconfig.Instance.GlobalDDLLogsWriter, appconfig.Instance.GlobalQueryLogsWriter)

	// ** Meta storage **
	metaStorageConfiguration := viper.Sub("meta.storage")
	metaStorage, err := meta.NewStorage(metaStorageConfiguration)
	if err != nil {
		logging.Fatalf("Error initializing meta storage: %v", err)
	}

	// ** Coordination Service **
	var coordinationService coordination.Service
	if viper.IsSet("coordination") {
		coordinationService, err = initializeCoordinationService(ctx, metaStorageConfiguration)
		if err != nil {
			logging.Fatalf("Failed to initiate coordination service: %v", err)
		}
	}

	if coordinationService == nil {
		//TODO remove deprecated someday
		//backward compatibility
		if viper.IsSet("synchronization_service") {
			logging.Warnf("\n\t'synchronization_service' configuration is DEPRECATED. For more details see https://jitsu.com/docs/other-features/scaling-eventnative")

			coordinationService, err = coordination.NewEtcdService(ctx, appconfig.Instance.ServerName, viper.GetString("synchronization_service.endpoint"), viper.GetUint("synchronization_service.connection_timeout_seconds"))
			if err != nil {
				logging.Fatal("Failed to initiate coordination service", err)
			}
			telemetry.Coordination("etcd_sync")
		} else {
			//inmemory service (default)
			logging.Info("❌ Coordination service isn't provided. Jitsu server is working in single-node mode. " +
				"\n\tRead about scaling Jitsu to multiple nodes: https://jitsu.com/docs/other-features/scaling-eventnative")
			coordinationService = coordination.NewInMemoryService([]string{appconfig.Instance.ServerName})
			telemetry.Coordination("inmemory")
		}
	}

	// ** Closing Meta Storage and Coordination SErvice
	// Close after all for saving last task statuses
	defer func() {
		if err := coordinationService.Close(); err != nil {
			logging.Errorf("Error closing coordination service: %v", err)
		}
		if err := metaStorage.Close(); err != nil {
			logging.Errorf("Error closing meta storage: %v", err)
		}
	}()

	// ** Destinations **
	//events counters
	counters.InitEvents(metaStorage)

	//events cache
	eventsCacheSize := viper.GetInt("server.cache.events.size")
	eventsCache := caching.NewEventsCache(metaStorage, eventsCacheSize)
	appconfig.Instance.ScheduleClosing(eventsCache)

	// ** Retrospective users recognition
	globalRecognitionConfiguration := &storages.UsersRecognition{
		Enabled:             viper.GetBool("users_recognition.enabled"),
		AnonymousIDNode:     viper.GetString("users_recognition.anonymous_id_node"),
		IdentificationNodes: viper.GetStringSlice("users_recognition.identification_nodes"),
		UserIDNode:          viper.GetString("users_recognition.user_id_node"),
	}

	if err := globalRecognitionConfiguration.Validate(); err != nil {
		logging.Fatalf("Invalid global users recognition configuration: %v", err)
	}

	maxColumns := viper.GetInt("server.max_columns")
	logging.Infof("📝 Limit server.max_columns is %d", maxColumns)
	destinationsFactory := storages.NewFactory(ctx, logEventPath, coordinationService, eventsCache, loggerFactory, globalRecognitionConfiguration, metaStorage, maxColumns)

	//Create event destinations
	destinationsService, err := destinations.NewService(viper.Sub(destinationsKey), viper.GetString(destinationsKey), destinationsFactory, loggerFactory, viper.GetBool("server.strict_auth_tokens"))
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
	if strings.HasPrefix(adminToken, "demo") {
		logging.Errorf("\n\t*** Please replace server.admin_token with any random string or uuid before deploying anything to production. Otherwise security of the platform can be compromised")
	}

	fallbackService, err := fallback.NewService(logEventPath, destinationsService, usersRecognitionService)
	if err != nil {
		logging.Fatal("Error creating fallback service:", err)
	}

	//** Segment API
	//field mapper
	mappings, err := schema.ConvertOldMappings(schema.Default, viper.GetStringSlice("compatibility.segment.endpoint"))
	if err != nil {
		logging.Fatal("Error converting Segment endpoint mappings:", err)
	}
	segmentRequestFieldsMapper, _, err := schema.NewFieldMapper(mappings)
	if err != nil {
		logging.Fatal("Error creating Segment endpoint data mapper:", err)
	}

	//compat mode field mapper
	compatMappings, err := schema.ConvertOldMappings(schema.Default, viper.GetStringSlice("compatibility.segment_compat.endpoint"))
	if err != nil {
		logging.Fatal("Error converting Segment compat endpoint mappings:", err)
	}
	segmentCompatRequestFieldsMapper, _, err := schema.NewFieldMapper(compatMappings)
	if err != nil {
		logging.Fatal("Error creating Segment compat endpoint data mapper:", err)
	}

	//version reminder banner in logs
	if tag != "" && !viper.GetBool("server.disable_version_reminder") {
		vn := appconfig.NewVersionReminder(ctx)
		vn.Start()
		appconfig.Instance.ScheduleClosing(vn)
	}

	systemService := system.NewService(viper.GetString("system"))

	router := routers.SetupRouter(adminToken, metaStorage, destinationsService, sourceService, taskService, usersRecognitionService, fallbackService,
		coordinationService, eventsCache, systemService, segmentRequestFieldsMapper, segmentCompatRequestFieldsMapper)

	telemetry.ServerStart()
	notifications.ServerStart()
	logging.Info("🚀 Started server: " + appconfig.Instance.Authority)
	server := &http.Server{
		Addr:              appconfig.Instance.Authority,
		Handler:           middleware.Cors(router, appconfig.Instance.AuthorizationService.GetClientOrigins),
		ReadTimeout:       time.Second * 60,
		ReadHeaderTimeout: time.Second * 60,
		IdleTimeout:       time.Second * 65,
	}
	logging.Fatal(server.ListenAndServe())
}

//initializeCoordinationService returns configured coordination.Service (redis or etcd or inmemory)
func initializeCoordinationService(ctx context.Context, metaStorageConfiguration *viper.Viper) (coordination.Service, error) {
	//etcd
	etcdEndpoint := viper.GetString("coordination.etcd.endpoint")
	if etcdEndpoint != "" {
		telemetry.Coordination("etcd")
		return coordination.NewEtcdService(ctx, appconfig.Instance.ServerName, viper.GetString("coordination.etcd.endpoint"), viper.GetUint("coordination.etcd.connection_timeout_seconds"))
	}

	//redis
	//shortcut for meta redis as coordination
	var coordinationRedisConfiguration *viper.Viper
	redisShortcut := viper.GetString("coordination.type")
	if redisShortcut == "redis" {
		coordinationRedisConfiguration = metaStorageConfiguration.Sub("redis")
		if coordinationRedisConfiguration == nil {
			return nil, errors.New("'meta.storage.redis' is required when Redis coordination shortcut is used")
		}
	} else {
		//plain redis configuration
		coordinationRedisConfiguration = viper.Sub("coordination.redis")
	}

	//configured
	if coordinationRedisConfiguration != nil {
		telemetry.Coordination("redis")
		redisConfig := &meta.RedisConfiguration{
			Host:          coordinationRedisConfiguration.GetString("host"),
			Port:          coordinationRedisConfiguration.GetInt("port"),
			Password:      coordinationRedisConfiguration.GetString("password"),
			TLSSkipVerify: coordinationRedisConfiguration.GetBool("tls_skip_verify"),
		}
		return coordination.NewRedisService(ctx, appconfig.Instance.ServerName, redisConfig)
	}

	return nil, errors.New("Unknown coordination configuration. Currently only [redis, etcd] are supported. " +
		"\n\tRead more about coordination service configuration: https://jitsu.com/docs/other-features/scaling-eventnative#coordination")
}
