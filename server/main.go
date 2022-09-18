package main

import (
	"context"
	"encoding/gob"
	"encoding/json"
	"errors"
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
	"github.com/jitsucom/jitsu/server/airbyte"
	"github.com/jitsucom/jitsu/server/appconfig"
	"github.com/jitsucom/jitsu/server/appstatus"
	"github.com/jitsucom/jitsu/server/caching"
	"github.com/jitsucom/jitsu/server/cmd"
	"github.com/jitsucom/jitsu/server/config"
	"github.com/jitsucom/jitsu/server/coordination"
	"github.com/jitsucom/jitsu/server/counters"
	"github.com/jitsucom/jitsu/server/destinations"
	"github.com/jitsucom/jitsu/server/enrichment"
	"github.com/jitsucom/jitsu/server/events"
	"github.com/jitsucom/jitsu/server/fallback"
	"github.com/jitsucom/jitsu/server/geo"
	"github.com/jitsucom/jitsu/server/logevents"
	"github.com/jitsucom/jitsu/server/logfiles"
	"github.com/jitsucom/jitsu/server/logging"
	"github.com/jitsucom/jitsu/server/meta"
	"github.com/jitsucom/jitsu/server/metrics"
	"github.com/jitsucom/jitsu/server/middleware"
	"github.com/jitsucom/jitsu/server/multiplexing"
	"github.com/jitsucom/jitsu/server/notifications"
	"github.com/jitsucom/jitsu/server/routers"
	"github.com/jitsucom/jitsu/server/runtime"
	"github.com/jitsucom/jitsu/server/safego"
	"github.com/jitsucom/jitsu/server/scheduling"
	"github.com/jitsucom/jitsu/server/schema"
	"github.com/jitsucom/jitsu/server/script"
	"github.com/jitsucom/jitsu/server/script/node"
	"github.com/jitsucom/jitsu/server/singer"
	"github.com/jitsucom/jitsu/server/sources"
	"github.com/jitsucom/jitsu/server/storages"
	"github.com/jitsucom/jitsu/server/synchronization"
	"github.com/jitsucom/jitsu/server/system"
	"github.com/jitsucom/jitsu/server/telemetry"
	"github.com/jitsucom/jitsu/server/templates"
	"github.com/jitsucom/jitsu/server/timestamp"
	"github.com/jitsucom/jitsu/server/users"
	"github.com/jitsucom/jitsu/server/uuid"
	"github.com/jitsucom/jitsu/server/wal"
	"github.com/spf13/viper"
)

// some inner parameters
const (
	//incoming.tok=$token-$timestamp.log
	uploaderFileMask = "incoming.tok=*-20*.log"
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

	logPathNotWritable = "Since eventnative docker user and owner of mounted dir are different: Please use 'chmod -R 777 your_mount_dir'"
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
	if len(os.Args) >= 2 && os.Args[1] == "replay" {
		cmd.Execute(tag)
		return
	}

	flag.Parse()

	//Configure gob
	gob.Register(json.Number(""))

	//Setup seed for globalRand
	rand.Seed(timestamp.Now().Unix())

	//Setup handlers binding for json parsing numbers into json.Number (not only in float64)
	binding.EnableDecoderUseNumber = true

	//Setup default timezone for timestamp.Now() calls
	time.Local = time.UTC

	// Setup application directory as working directory
	setAppWorkDir()

	if err := appconfig.Read(*configSource, *containerizedRun, configNotFound, "Jitsu Server"); err != nil {
		logging.Fatal("Error while reading application config:", err)
	}

	//parse EN version
	appconfig.RawVersion = tag
	appconfig.BuiltAt = builtAt
	parsed := appconfig.VersionRegex.FindStringSubmatch(tag)
	if len(parsed) == 4 {
		appconfig.MajorVersion = parsed[1]
		appconfig.MinorVersion = parsed[3]
		appconfig.Beta = parsed[2] == "beta"
	}
	if tag == "beta" {
		appconfig.Beta = true
	}

	environment := os.Getenv("ENVIRONMENT")
	if environment != "" {
		dockerHubID = &environment
	}

	if err := appconfig.Init(*containerizedRun, *dockerHubID); err != nil {
		logging.Fatal(err)
	}

	//TELEMETRY
	telemetryURL := viper.GetString("server.telemetry")
	if telemetryURL == "" && appconfig.Instance.ConfiguratorURL != "" {
		telemetryURL = fmt.Sprintf("%s/api/v1/telemetry?token=%s", appconfig.Instance.ConfiguratorURL, appconfig.Instance.ConfiguratorToken)
	}

	telemetry.InitFromViper(telemetryURL, notifications.ServiceName, commit, tag, builtAt, *dockerHubID)

	// ** Meta storage **
	metaStorageConfiguration := viper.Sub("meta.storage")
	metaStorage, err := meta.InitializeStorage(metaStorageConfiguration)
	if err != nil {
		logging.Fatalf("Error initializing meta storage: %v", err)
	}
	ctx, cancel := context.WithCancel(context.Background())

	// ** Coordination Service **
	var coordinationService *coordination.Service
	if viper.IsSet("coordination") {
		coordinationService, err = initializeCoordinationService(ctx, metaStorageConfiguration)
		if err != nil {
			logging.Fatalf("Failed to initiate coordination service: %v", err)
		}
	}

	if coordinationService == nil {
		//inmemory service (default)
		logging.Info("❌ Coordination service isn't provided. Jitsu server is working in single-node mode. " +
			"\n\tRead about scaling Jitsu to multiple nodes: https://jitsu.com/docs/other-features/scaling-eventnative")
		telemetry.Coordination("inmemory")
		coordinationService = coordination.NewInMemoryService(appconfig.Instance.ServerName)
	}

	if err := singer.Init(viper.GetString("singer-bridge.python"), metaStorage, coordinationService, viper.GetString("singer-bridge.venv_dir"),
		viper.GetBool("singer-bridge.install_taps"), viper.GetBool("singer-bridge.update_taps"), viper.GetInt("singer-bridge.batch_size"), appconfig.Instance.SingerLogsWriter); err != nil {
		logging.Fatal(err)
	}

	if err := airbyte.Init(ctx, *containerizedRun, viper.GetString("airbyte-bridge.config_dir"), viper.GetString("server.volumes.workspace"), viper.GetInt("airbyte-bridge.batch_size"), appconfig.Instance.AirbyteLogsWriter); err != nil {
		logging.Errorf("❌ Airbyte integration is disabled: %v", err)
	}

	//GEO Resolvers
	geoResolversURL := viper.GetString("geo_resolvers")
	if geoResolversURL == "" && appconfig.Instance.ConfiguratorURL != "" {
		geoResolversURL = fmt.Sprintf("%s/api/v1/geo_data_resolvers?token=%s", appconfig.Instance.ConfiguratorURL, appconfig.Instance.ConfiguratorToken)
	}

	geoService := geo.NewService(ctx, geoResolversURL, viper.GetString("geo.maxmind_path"), viper.GetString("maxmind.official_url"))

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

	clusterID := metaStorage.GetOrCreateClusterID(uuid.New())
	systemInfo := runtime.GetInfo()
	telemetry.EnrichSystemInfo(clusterID, systemInfo)

	metricsExported := viper.GetBool("server.metrics.prometheus.enabled")
	metricsRelay := metrics.InitRelay(clusterID, viper.Sub("server.metrics.relay"))
	if metricsExported || metricsRelay != nil {
		metrics.Init(metricsExported)
		if metricsRelay != nil {
			interval := 5 * time.Minute
			if viper.IsSet("server.metrics.relay.interval") {
				interval = viper.GetDuration("server.metrics.relay.interval")
			}

			trigger := metrics.TickerTrigger{Ticker: time.NewTicker(interval)}
			metricsRelay.Run(ctx, trigger, metrics.Registry)
		}
	}

	slackNotificationsWebHook := viper.GetString("notifications.slack.url")
	if slackNotificationsWebHook != "" {
		notifications.Init(notifications.ServiceName, tag, slackNotificationsWebHook, appconfig.Instance.ServerName, logging.Errorf)
	}

	//listen to shutdown signal to free up all resources
	c := make(chan os.Signal, 1)
	signal.Notify(c, syscall.SIGTERM, syscall.SIGINT, syscall.SIGKILL, syscall.SIGHUP)
	go func() {
		<-c
		logging.Info("🤖 * Server is shutting down.. *")

		if metricsRelay != nil {
			metricsRelay.Stop()
		}

		telemetry.ServerStop()
		appstatus.Instance.Idle.Store(true)
		cancel()
		appconfig.Instance.Close()
		telemetry.Flush()
		notifications.Flush()
		time.Sleep(4 * time.Second)
		telemetry.Close()
		//we should close it in the end
		appconfig.Instance.CloseEventsConsumers()
		appconfig.Instance.CloseWriteAheadLog()
		counters.Close()
		notifications.Close()
		appconfig.Instance.CloseLast()
		geoService.Close()
		time.Sleep(time.Second)
		os.Exit(0)
	}()

	//Get logger configuration
	logEventPath := viper.GetString("log.path")
	// Create full path to logs directory if it is necessary
	logging.Infof("📂 Create log.path directory: %q", logEventPath)
	if err := logging.EnsureDir(logEventPath); err != nil {
		logging.Fatalf("log.path: %q cannot be created: %v. %s", logEventPath, err, logPathNotWritable)
	}

	//check if log.path is writable
	if !logging.IsDirWritable(logEventPath) {
		logging.Fatalf("log.path: %q must be writable! %s", logEventPath, logPathNotWritable)
	}
	logRotationMin := viper.GetInt64("log.rotation_min")

	loggerFactory := logevents.NewFactory(logEventPath, logRotationMin, viper.GetBool("log.show_in_server"),
		appconfig.Instance.GlobalDDLLogsWriter, appconfig.Instance.GlobalQueryLogsWriter, viper.GetBool("log.async_writers"),
		viper.GetInt("log.pool.size"))

	// ** Destinations **
	//events queue
	//by default Redis based if events.queue.redis or meta.storage configured
	//otherwise inmemory
	//to force inmemory set events.queue.inmemory: true
	var eventsQueueFactory *events.QueueFactory
	if viper.GetBool("events.queue.inmemory") {
		eventsQueueFactory, err = initializeEventsQueueFactory(nil)
	} else {
		eventsQueueFactory, err = initializeEventsQueueFactory(metaStorageConfiguration)
	}
	if err != nil {
		logging.Fatal(err)
	}

	// ** Closing Meta Storage and Coordination Service
	// Close after all for saving last task statuses
	appconfig.Instance.ScheduleLastClosing(eventsQueueFactory)
	appconfig.Instance.ScheduleLastClosing(coordinationService)
	appconfig.Instance.ScheduleLastClosing(metaStorage)

	//event counters
	counters.InitEvents(metaStorage)

	//events cache
	eventsCacheEnabled := viper.GetBool("server.cache.enabled")
	eventsCacheSize := viper.GetInt("server.cache.events.size")
	timeWindowSeconds := viper.GetInt("server.cache.events.time_window_sec")
	eventsCacheTrimIntervalMs := viper.GetInt("server.cache.events.trim_interval_ms")
	eventsCachePoolSize := viper.GetInt("server.cache.pool.size")
	if timeWindowSeconds == 0 {
		timeWindowSeconds = 1
		logging.Infof("server.cache.events.time_window_sec can't be 0. Using default value=1 instead")
	}
	if eventsCachePoolSize == 0 {
		eventsCachePoolSize = 1
		logging.Infof("server.cache.pool.size can't be 0. Using default value=1 instead")

	}
	eventsCache := caching.NewEventsCache(eventsCacheEnabled, metaStorage, eventsCacheSize, eventsCachePoolSize, eventsCacheTrimIntervalMs, timeWindowSeconds)
	appconfig.Instance.ScheduleClosing(eventsCache)

	// ** Retroactive users recognition
	globalRecognitionConfiguration := &config.UsersRecognition{
		Enabled:             viper.GetBool("users_recognition.enabled"),
		AnonymousIDNode:     viper.GetString("users_recognition.anonymous_id_node"),
		IdentificationNodes: viper.GetStringSlice("users_recognition.identification_nodes"),
		UserIDNode:          viper.GetString("users_recognition.user_id_node"),
		PoolSize:            viper.GetInt("users_recognition.pool.size"),
		Compression:         viper.GetString("users_recognition.compression"),
		CacheTTLMin:         viper.GetInt("users_recognition.cache_ttl_min"),
	}

	if err := globalRecognitionConfiguration.Validate(); err != nil {
		logging.Fatalf("Invalid global users recognition configuration: %v", err)
	}

	if globalRecognitionConfiguration.PoolSize == 0 {
		globalRecognitionConfiguration.PoolSize = 1
		logging.Infof("users_recognition.pool.size can't be 0. Using default value=1 instead")
	}
	transformStorage, err := script.InitializeStorage(true, metaStorageConfiguration)
	if err != nil {
		logging.Fatalf("Error initializing transform key value storage: %v", err)
	}

	scriptFactory, err := node.NewFactory(viper.GetInt("node.pool_size"), viper.GetInt("node.max_space"), transformStorage)
	if err != nil {
		logging.Warn(err)
	} else {
		appconfig.Instance.ScheduleLastClosing(scriptFactory)
		templates.SetScriptFactory(scriptFactory)
	}

	maxColumns := viper.GetInt("server.max_columns")
	logging.Infof("📝 Limit server.max_columns is %d", maxColumns)
	destinationsFactory := storages.NewFactory(ctx, logEventPath, geoService, coordinationService, eventsCache, loggerFactory,
		globalRecognitionConfiguration, metaStorage, eventsQueueFactory, maxColumns)

	//DESTINATIONS
	destinationsURL := viper.GetString(destinationsKey)
	if destinationsURL == "" && appconfig.Instance.ConfiguratorURL != "" {
		destinationsURL = fmt.Sprintf("%s/api/v1/destinations?token=%s", appconfig.Instance.ConfiguratorURL, appconfig.Instance.ConfiguratorToken)
	}

	//Create event destinations
	destinationsService, err := destinations.NewService(viper.Sub(destinationsKey), destinationsURL, destinationsFactory, loggerFactory, viper.GetBool("server.strict_auth_tokens"))
	if err != nil {
		logging.Fatal(err)
	}
	appconfig.Instance.ScheduleClosing(destinationsService)

	userRecognitionStorage, err := users.InitializeStorage(globalRecognitionConfiguration.Enabled, metaStorageConfiguration)
	if err != nil {
		logging.Fatalf("Error initializing users recognition storage: %v", err)
	}

	usersRecognitionService, err := users.NewRecognitionService(userRecognitionStorage, destinationsService, globalRecognitionConfiguration, viper.GetString("server.fields_configuration.user_agent_path"))
	if err != nil {
		logging.Fatal(err)
	}
	appconfig.Instance.ScheduleClosing(usersRecognitionService)

	// ** Sources **

	//Create source&collection sync scheduler
	cronScheduler := scheduling.NewCronScheduler()
	appconfig.Instance.ScheduleClosing(cronScheduler)

	//SOURCES
	//Create sources
	sourcesURL := viper.GetString(sourcesKey)
	if sourcesURL == "" && appconfig.Instance.ConfiguratorURL != "" {
		sourcesURL = fmt.Sprintf("%s/api/v1/sources?token=%s", appconfig.Instance.ConfiguratorURL, appconfig.Instance.ConfiguratorToken)
	}

	sourceService, err := sources.NewService(ctx, viper.Sub(sourcesKey), sourcesURL, destinationsService, metaStorage, cronScheduler)
	if err != nil {
		logging.Fatal("Error creating sources service:", err)
	}
	appconfig.Instance.ScheduleClosing(sourceService)

	storeTasksLogsForLastRuns := viper.GetInt("server.sync_tasks.store_logs.last_runs")
	//Create sync task service
	taskService := synchronization.NewTaskService(sourceService, destinationsService, metaStorage, coordinationService, storeTasksLogsForLastRuns)

	poolSize := viper.GetInt("server.sync_tasks.pool.size")
	if poolSize > 0 {
		logging.Infof("Sources sync task executor pool size: %d", poolSize)
		//Start cron scheduler
		if taskService.IsConfigured() {
			cronScheduler.Start(taskService.ScheduleSyncFunc)
		}

		notificationCtx := &synchronization.NotificationContext{
			ServiceName: notifications.ServiceName,
			Version:     tag,
			ServerName:  appconfig.Instance.ServerName,
			UIBaseURL:   viper.GetString("ui.base_url"),
		}

		taskExecutorContext := &synchronization.TaskExecutorContext{
			SourceService:         sourceService,
			DestinationService:    destinationsService,
			MetaStorage:           metaStorage,
			CoordinationService:   coordinationService,
			StalledThreshold:      time.Duration(viper.GetInt("server.sync_tasks.stalled.last_heartbeat_threshold_seconds")) * time.Second,
			LastActivityThreshold: time.Duration(viper.GetInt("server.sync_tasks.stalled.last_activity_threshold_minutes")) * time.Minute,
			ObserverStalledEvery:  time.Duration(viper.GetInt("server.sync_tasks.stalled.observe_stalled_every_seconds")) * time.Second,
			NotificationService:   synchronization.NewNotificationService(notificationCtx, viper.GetStringMap("notifications")),
		}

		//Create task executor
		taskExecutor, err := synchronization.NewTaskExecutor(poolSize, taskExecutorContext, appconfig.Instance.SourcesLogsWriter)
		if err != nil {
			logging.Fatal("Error creating sources sync task executor:", err)
		}
		appconfig.Instance.ScheduleClosing(taskExecutor)
	} else {
		logging.Warnf("Sources sync task executor pool size: %d. Task executor is disabled.", poolSize)
	}

	//for now use the same interval as for log rotation
	uploaderRunInterval := viper.GetInt("log.rotation_min")
	//Uploader must read event logger directory
	uploader, err := logfiles.NewUploader(logEventPath, uploaderFileMask, uploaderRunInterval, appconfig.Instance.ErrorRetryPeriod, destinationsService)
	if err != nil {
		logging.Fatal("Error while creating file uploader", err)
	}
	uploader.Start()

	//Streaming events archiver
	periodicArchiver := logfiles.NewPeriodicArchiver(streamArchiveFileMask, path.Join(logEventPath, logevents.ArchiveDir), time.Duration(streamArchiveEveryS)*time.Second)
	appconfig.Instance.ScheduleClosing(periodicArchiver)

	adminToken := viper.GetString("server.admin_token")
	if strings.HasPrefix(adminToken, "demo") {
		logging.Warn("\t⚠️ Please replace server.admin_token (CLUSTER_ADMIN_TOKEN env variable) with any random string or uuid before deploying anything to production. Otherwise security of the platform can be compromised")
	}

	fallbackService, err := fallback.NewService(logEventPath, destinationsService, usersRecognitionService)
	if err != nil {
		logging.Fatal("Error creating fallback service:", err)
	}

	//** Segment API
	//field mapper
	mappings, err := schema.ConvertOldMappings(config.Default, viper.GetStringSlice("compatibility.segment.endpoint"))
	if err != nil {
		logging.Fatal("Error converting Segment endpoint mappings:", err)
	}
	segmentRequestFieldsMapper, _, err := schema.NewFieldMapper(mappings)
	if err != nil {
		logging.Fatal("Error creating Segment endpoint data mapper:", err)
	}

	//compat mode field mapper
	compatMappings, err := schema.ConvertOldMappings(config.Default, viper.GetStringSlice("compatibility.segment_compat.endpoint"))
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

	//SYSTEM
	systemConfigurationURL := viper.GetString("system")
	if systemConfigurationURL == "" && appconfig.Instance.ConfiguratorURL != "" {
		systemConfigurationURL = fmt.Sprintf("%s/api/v1/system/configuration", appconfig.Instance.ConfiguratorURL)
	}
	systemService := system.NewService(systemConfigurationURL)

	//event processors
	apiProcessor := events.NewAPIProcessor(usersRecognitionService)
	bulkProcessor := events.NewBulkProcessor()
	jsProcessor := events.NewJsProcessor(usersRecognitionService, viper.GetString("server.fields_configuration.user_agent_path"))
	pixelProcessor := events.NewPixelProcessor()
	segmentProcessor := events.NewSegmentProcessor(usersRecognitionService)
	processorHolder := events.NewProcessorHolder(apiProcessor, jsProcessor, pixelProcessor, segmentProcessor, bulkProcessor)

	multiplexingService := multiplexing.NewService(destinationsService)
	walService := wal.NewService(logEventPath, loggerFactory.CreateWriteAheadLogger(), multiplexingService, processorHolder)
	appconfig.Instance.ScheduleWriteAheadLogClosing(walService)

	router := routers.SetupRouter(adminToken, metaStorage, destinationsService, sourceService, taskService, fallbackService,
		coordinationService, eventsCache, systemService, segmentRequestFieldsMapper, segmentCompatRequestFieldsMapper, processorHolder,
		multiplexingService, walService, geoService, globalRecognitionConfiguration)

	telemetry.ServerStart()
	notifications.ServerStart(systemInfo)
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

// initializeCoordinationService returns configured coordination.Service (redis or inmemory)
func initializeCoordinationService(ctx context.Context, metaStorageConfiguration *viper.Viper) (*coordination.Service, error) {
	//check deprecated etcd
	if viper.GetString("coordination.etcd.endpoint") != "" || viper.IsSet("synchronization_service") {
		return nil, fmt.Errorf("coordination.etcd is no longer supported. Please use Redis instead. Read more about coordination service https://jitsu.com/docs/deployment/scale#redis")
	}

	//redis
	//shortcut for meta redis as coordination
	var coordinationRedisConfiguration *viper.Viper
	redisShortcut := viper.GetString("coordination.type")
	if redisShortcut == "redis" {
		if metaStorageConfiguration != nil {
			coordinationRedisConfiguration = metaStorageConfiguration.Sub("redis")
		}

		if coordinationRedisConfiguration == nil || coordinationRedisConfiguration.GetString("host") == "" {
			//coordination.type is set but no Redis provided (e.g. in case of solo jitsucom/server without Redis)
			return nil, nil
		}
	} else {
		//plain redis configuration
		coordinationRedisConfiguration = viper.Sub("coordination.redis")
	}

	//configured
	if coordinationRedisConfiguration != nil {
		host := coordinationRedisConfiguration.GetString("host")
		if host == "" {
			return nil, errors.New("coordination.redis.host is required config parameter")
		}

		telemetry.Coordination("redis")
		factory := meta.NewRedisPoolFactory(host, coordinationRedisConfiguration.GetInt("port"), coordinationRedisConfiguration.GetString("password"), coordinationRedisConfiguration.GetInt("database"), coordinationRedisConfiguration.GetBool("tls_skip_verify"), coordinationRedisConfiguration.GetString("sentinel_master_name"))
		factory.CheckAndSetDefaultPort()
		return coordination.NewRedisService(ctx, appconfig.Instance.ServerName, factory)
	}

	return nil, errors.New("Unknown coordination configuration. Currently only [redis] is supported. " +
		"\n\tRead more about coordination service configuration: https://jitsu.com/docs/deployment/scale#coordination")
}

// initializeEventsQueueFactory returns configured events.QueueFactory (redis or inmemory)
func initializeEventsQueueFactory(metaStorageConfiguration *viper.Viper) (*events.QueueFactory, error) {
	var redisConfigurationSource *viper.Viper

	if metaStorageConfiguration != nil {
		//redis config from meta.storage section
		redisConfigurationSource = metaStorageConfiguration.Sub("redis")
	}

	//get redis configuration from separated config section if configured
	if viper.GetString("events.queue.redis.host") != "" {
		redisConfigurationSource = viper.Sub("events.queue.redis")
	}

	var pollTimeout time.Duration
	var eventsQueueRedisPool *meta.RedisPool
	var err error
	if redisConfigurationSource != nil && redisConfigurationSource.GetString("host") != "" {
		factory := meta.NewRedisPoolFactory(redisConfigurationSource.GetString("host"), redisConfigurationSource.GetInt("port"), redisConfigurationSource.GetString("password"), redisConfigurationSource.GetInt("database"), redisConfigurationSource.GetBool("tls_skip_verify"), redisConfigurationSource.GetString("sentinel_master_name"))
		opts := meta.DefaultOptions
		opts.MaxActive = 5000
		factory.WithOptions(opts)
		pollTimeout = factory.GetOptions().DefaultDialReadTimeout
		factory.CheckAndSetDefaultPort()
		eventsQueueRedisPool, err = factory.Create()
		if err != nil {
			return nil, fmt.Errorf("error creating events queue redis pool: %v", err)
		}
	}

	return events.NewQueueFactory(eventsQueueRedisPool, pollTimeout), nil
}
