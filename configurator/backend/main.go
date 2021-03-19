package main

import (
	"context"
	"flag"
	"github.com/gin-gonic/contrib/static"
	"github.com/gin-gonic/gin"
	"github.com/jitsucom/jitsu/configurator/appconfig"
	"github.com/jitsucom/jitsu/configurator/authorization"
	"github.com/jitsucom/jitsu/configurator/destinations"
	"github.com/jitsucom/jitsu/configurator/emails"
	"github.com/jitsucom/jitsu/configurator/eventnative"
	"github.com/jitsucom/jitsu/configurator/handlers"
	"github.com/jitsucom/jitsu/configurator/middleware"
	"github.com/jitsucom/jitsu/configurator/ssh"
	"github.com/jitsucom/jitsu/configurator/ssl"
	"github.com/jitsucom/jitsu/configurator/statistics"
	"github.com/jitsucom/jitsu/configurator/storages"
	enadapters "github.com/jitsucom/jitsu/server/adapters"
	"github.com/jitsucom/jitsu/server/logging"
	"github.com/jitsucom/jitsu/server/notifications"
	"github.com/jitsucom/jitsu/server/safego"
	enstorages "github.com/jitsucom/jitsu/server/storages"
	"github.com/jitsucom/jitsu/server/telemetry"
	"github.com/spf13/viper"
	"os"
	"os/signal"
	"path/filepath"
	"runtime/debug"
	"syscall"

	"net/http"
	"strings"
	"time"
)

const serviceName = "EN-manager"

var (
	configFilePath   = flag.String("cfg", "", "config file path")
	containerizedRun = flag.Bool("cr", false, "containerised run marker")

	//ldflags
	commit  string
	tag     string
	builtAt string
)

func main() {
	flag.Parse()

	//Setup default timezone for time.Now() calls
	time.Local = time.UTC

	// Setup application directory as working directory
	setAppWorkDir()

	readConfiguration(*configFilePath)

	//listen to shutdown signal to free up all resources
	ctx, cancel := context.WithCancel(context.Background())
	c := make(chan os.Signal, 1)
	signal.Notify(c, syscall.SIGTERM, syscall.SIGINT, syscall.SIGKILL, syscall.SIGHUP)
	go func() {
		<-c
		cancel()
		appconfig.Instance.Close()
		telemetry.Flush()
		time.Sleep(1 * time.Second)
		telemetry.Close()
		os.Exit(0)
	}()

	telemetry.InitFromViper(serviceName, commit, tag, builtAt)

	safego.GlobalRecoverHandler = func(value interface{}) {
		logging.Error("panic")
		logging.Error(value)
		logging.Error(string(debug.Stack()))
		notifications.SystemErrorf("Panic:\n%s\n%s", value, string(debug.Stack()))
	}

	//** Slack Notifications **
	slackNotificationsWebHook := viper.GetString("notifications.slack.url")
	if slackNotificationsWebHook != "" {
		notifications.Init(serviceName, slackNotificationsWebHook, appconfig.Instance.ServerName, logging.Errorf)
	}

	//** Default S3 **
	var s3Config *enadapters.S3Config
	if viper.IsSet("destinations.hosted.s3") {
		s3Config = &enadapters.S3Config{}
		if err := viper.UnmarshalKey("destinations.hosted.s3", s3Config); err != nil {
			logging.Fatal("Error unmarshalling default s3 config:", err)
		}
		if err := s3Config.Validate(); err != nil {
			logging.Fatal("Error validation default s3 config:", err)
		}
	}

	//** Postgres for default destinations
	var defaultPostgres *destinations.Postgres
	var err error
	if viper.IsSet("destinations.default.postgres") {
		defaultPostgres, err = destinations.NewPostgres(ctx, viper.Sub("destinations.default.postgres"))
		if err != nil {
			logging.Fatalf("Error creating destinations.default: %v", err)
		}
	}

	//** Main Storage **
	if !viper.IsSet("storage") {
		logging.Fatalf("'storage' is required configuration section")
	}
	configurationsStorage, err := storages.NewConfigurationsStorage(ctx, viper.Sub("storage"), defaultPostgres)
	if err != nil {
		logging.Fatalf("Error creating configurations storage: %v", err)
	}

	configurationsService := storages.NewConfigurationsService(configurationsStorage, defaultPostgres)
	if err != nil {
		logging.Fatalf("Error creating configurations service: %v", err)
	}
	appconfig.Instance.ScheduleClosing(configurationsService)

	//** Authorization service **
	if !viper.IsSet("auth") {
		logging.Fatal("'auth' is required configuration parameter")
	}

	authService, err := authorization.NewService(ctx, viper.Sub("auth"), configurationsStorage)
	if err != nil {
		logging.Fatalf("Error creating authorization service: %v", err)
	}
	appconfig.Instance.ScheduleClosing(authService)

	//** Statistics **
	statisticsStorage, err := statistics.NewStorage(viper.Sub("statistics"), viper.GetStringMapStringSlice("old_keys"))
	if err != nil {
		logging.Fatalf("Error initializing 'destinations.statistics': %v", err)
	}
	appconfig.Instance.ScheduleClosing(statisticsStorage)

	//statistics postgres
	var pgStatisticsConfig *enstorages.DestinationConfig
	if viper.IsSet("statistics.postgres") {
		pgStatisticsConfig = &enstorages.DestinationConfig{}
		if err := viper.UnmarshalKey("statistics.postgres", pgStatisticsConfig); err != nil {
			logging.Fatal("Error unmarshalling statistics postgres config:", err)
		}
		if err := pgStatisticsConfig.DataSource.Validate(); err != nil {
			logging.Fatal("Error validation statistics postgres config:", err)
		}
	}

	//** EventNative configuration **
	if !viper.IsSet("eventnative") {
		logging.Fatal("'eventnative' is required configuration section")
	}

	enConfig := &eventnative.Config{}
	err = viper.UnmarshalKey("eventnative", enConfig)
	if err != nil {
		logging.Fatalf("Error parsing 'eventnative' config: %v", err)
	}
	err = enConfig.Validate()
	if err != nil {
		logging.Fatalf("Error validating 'eventnative' config: %v", err)
	}

	enService := eventnative.NewService(enConfig.BaseUrl, enConfig.AdminToken)
	appconfig.Instance.ScheduleClosing(enService)

	//** SSL **
	var sslUpdateExecutor *ssl.UpdateExecutor
	if enConfig.SSL != nil {
		sshClient, err := ssh.NewSshClient(enConfig.SSL.SSH.PrivateKeyPath, enConfig.SSL.SSH.User)
		if err != nil {
			logging.Fatalf("Error creating SSH client: %v", err)
		}

		customDomainProcessor, err := ssl.NewCertificateService(sshClient, enConfig.SSL.Hosts, configurationsService, enConfig.SSL.ServerConfigTemplate, enConfig.SSL.NginxConfigPath, enConfig.SSL.AcmeChallengePath)

		sslUpdateExecutor = ssl.NewSSLUpdateExecutor(customDomainProcessor, enConfig.SSL.Hosts, enConfig.SSL.SSH.User, enConfig.SSL.SSH.PrivateKeyPath, enConfig.CName, enConfig.SSL.CertificatePath, enConfig.SSL.PKPath, enConfig.SSL.AcmeChallengePath)
	}

	//** SMTP (email service) **
	var smtp *emails.SmtpConfiguration
	if viper.IsSet("smtp") {
		smtp = &emails.SmtpConfiguration{
			Host:     viper.GetString("smtp.host"),
			Port:     viper.GetInt("smtp.port"),
			User:     viper.GetString("smtp.user"),
			Password: viper.GetString("smtp.password"),
		}

		err := smtp.Validate()
		if err != nil {
			logging.Fatalf("Error smtp configuration: %v", err)
		}
	}
	emailsService, err := emails.NewService(smtp)
	if err != nil {
		logging.Fatalf("Error creating emails service: %v", err)
	}

	serverDomain := viper.GetString("server.domain")
	if serverDomain == "" {
		logging.Fatal("'server.domain' is required configuration parameter (format: 'domain.com'). It is used in CORS filter.")
	}

	router := SetupRouter(enService, configurationsStorage, configurationsService,
		authService, s3Config, pgStatisticsConfig, statisticsStorage, sslUpdateExecutor, emailsService)
	notifications.ServerStart()
	logging.Info("Started server: " + appconfig.Instance.Authority)
	server := &http.Server{
		Addr:              appconfig.Instance.Authority,
		Handler:           middleware.Cors(router, serverDomain),
		ReadTimeout:       time.Second * 60,
		ReadHeaderTimeout: time.Second * 60,
		IdleTimeout:       time.Second * 65,
	}
	logging.Fatal(server.ListenAndServe())
}

func readConfiguration(configFilePath string) {
	viper.AutomaticEnv()
	viper.SetEnvKeyReplacer(strings.NewReplacer(".", "_"))
	if configFilePath != "" {
		logging.Infof("Reading config from %s", configFilePath)
	}
	viper.SetConfigFile(configFilePath)
	if err := viper.ReadInConfig(); err != nil {
		if viper.ConfigFileUsed() != "" {
			logging.Fatal("Could not read file", viper.ConfigFileUsed())
		}
	}
	if err := appconfig.Init(*containerizedRun); err != nil {
		logging.Fatal(err)
	}
}

func SetupRouter(enService *eventnative.Service, configurationsStorage storages.ConfigurationsStorage,
	configurationsService *storages.ConfigurationsService, authService *authorization.Service, defaultS3 *enadapters.S3Config,
	pgStatisticsConfig *enstorages.DestinationConfig, statisticsStorage statistics.Storage, sslUpdateExecutor *ssl.UpdateExecutor,
	emailService *emails.Service) *gin.Engine {
	gin.SetMode(gin.ReleaseMode)
	router := gin.New()
	router.Use(gin.Recovery())
	//TODO when https://github.com/gin-gonic will have a new version (https://github.com/gin-gonic/gin/pull/2322)
	/*router.Use(gin.CustomRecovery(func(c *gin.Context, recovered interface{}) {
	    c.JSON(http.StatusInternalServerError, `{"err":"System error on %s server"}`
	}))*/

	router.Use(static.Serve("/", static.LocalFile("./web", true)))
	router.NoRoute(func(c *gin.Context) {
		c.File("./web/index.html")
	})

	authenticatorMiddleware := middleware.NewAuthenticator(authService)

	router.GET("/ping", func(c *gin.Context) {
		c.String(http.StatusOK, "pong")
	})

	serverToken := viper.GetString("server.auth")

	statisticsHandler := handlers.NewStatisticsHandler(statisticsStorage, configurationsService)
	apiKeysHandler := handlers.NewApiKeysHandler(configurationsService)

	enConfigurationsHandler := handlers.NewConfigurationsHandler(configurationsStorage)

	apiV1 := router.Group("/api/v1")
	{
		apiV1.POST("/database", authenticatorMiddleware.ClientProjectAuth(handlers.NewDatabaseHandler(configurationsService).PostHandler))
		apiV1.POST("/apikeys/default", authenticatorMiddleware.ClientProjectAuth(apiKeysHandler.CreateDefaultApiKeyHandler))

		apiV1.GET("/apikeys", middleware.ServerAuth(middleware.IfModifiedSince(apiKeysHandler.GetHandler, configurationsService.GetApiKeysLastUpdated), serverToken))
		apiV1.GET("/statistics", authenticatorMiddleware.ClientProjectAuth(statisticsHandler.GetHandler))

		apiV1.GET("/eventnative/configuration", authenticatorMiddleware.ClientProjectAuth(handlers.NewConfigurationHandler(configurationsService, defaultS3).Handler))

		if sslUpdateExecutor != nil {
			sslGroup := apiV1.Group("/ssl")
			{
				sslGroup.POST("/", authenticatorMiddleware.ClientProjectAuth(handlers.NewCustomDomainHandler(sslUpdateExecutor).PerProjectHandler))
				sslGroup.POST("/all", middleware.ServerAuth(handlers.NewCustomDomainHandler(sslUpdateExecutor).AllHandler, serverToken))
			}
		}

		destinationsHandler := handlers.NewDestinationsHandler(configurationsService, defaultS3, pgStatisticsConfig, enService)
		destinationsRoute := apiV1.Group("/destinations")
		{
			destinationsRoute.GET("/", middleware.ServerAuth(middleware.IfModifiedSince(destinationsHandler.GetHandler, configurationsService.GetDestinationsLastUpdated), serverToken))
			destinationsRoute.POST("/test", authenticatorMiddleware.ClientProjectAuth(destinationsHandler.TestHandler))
		}

		sourcesHandlers := handlers.NewSourcesHandler(configurationsService, enService)
		sourcesRoute := apiV1.Group("/sources")
		{
			sourcesRoute.POST("/test", authenticatorMiddleware.ClientProjectAuth(sourcesHandlers.TestHandler))
		}

		telemetryHandler := handlers.NewTelemetryHandler(configurationsStorage)
		apiV1.GET("/telemetry", middleware.ServerAuth(telemetryHandler.GetHandler, serverToken))

		eventsHandler := handlers.NewEventsHandler(configurationsService, enService)
		apiV1.GET("/events", authenticatorMiddleware.ClientProjectAuth(eventsHandler.OldGetHandler))
		apiV1.GET("/last_events", authenticatorMiddleware.ClientProjectAuth(eventsHandler.GetHandler))

		apiV1.GET("/become", authenticatorMiddleware.ClientAuth(handlers.NewBecomeUserHandler(authService).Handler))

		apiV1.GET("/configurations/:collection", authenticatorMiddleware.ClientProjectAuth(enConfigurationsHandler.GetConfig))
		apiV1.POST("/configurations/:collection", authenticatorMiddleware.ClientProjectAuth(enConfigurationsHandler.StoreConfig))

		apiV1.GET("/system/configuration", handlers.NewSystemHandler(authService, emailService.IsConfigured(), viper.GetBool("server.self_hosted")).GetHandler)

		usersApiGroup := apiV1.Group("/users")
		{
			usersApiGroup.GET("/info", authenticatorMiddleware.ClientAuth(enConfigurationsHandler.GetUserInfo))
			usersApiGroup.POST("/info", authenticatorMiddleware.ClientAuth(enConfigurationsHandler.StoreUserInfo))
		}

		//authorization
		if authService.GetAuthorizationType() == authorization.RedisType {
			authHandler := handlers.NewAuthorizationHandler(authService, emailService, configurationsStorage)

			usersApiGroup.POST("/signup", authHandler.SignUp)
			usersApiGroup.POST("/onboarded/signup", authHandler.OnboardedSignUp)
			usersApiGroup.POST("/signin", authHandler.SignIn)
			usersApiGroup.POST("/signout", authenticatorMiddleware.ClientAuth(authHandler.SignOut))

			passwordApiGroup := usersApiGroup.Group("/password")
			{
				passwordApiGroup.POST("/reset", authHandler.ResetPassword)
				passwordApiGroup.POST("/change", authHandler.ChangePassword)
			}

			usersApiGroup.POST("/token/refresh", authHandler.RefreshToken)
		}

	}

	return router
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
