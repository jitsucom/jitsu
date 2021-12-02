package main

import (
	"context"
	"flag"
	"github.com/gin-gonic/contrib/static"
	"github.com/gin-gonic/gin"
	"github.com/gin-gonic/gin/binding"
	"github.com/jitsucom/jitsu/configurator/appconfig"
	"github.com/jitsucom/jitsu/configurator/authorization"
	"github.com/jitsucom/jitsu/configurator/cors"
	"github.com/jitsucom/jitsu/configurator/destinations"
	"github.com/jitsucom/jitsu/configurator/emails"
	"github.com/jitsucom/jitsu/configurator/handlers"
	"github.com/jitsucom/jitsu/configurator/jitsu"
	"github.com/jitsucom/jitsu/configurator/middleware"
	"github.com/jitsucom/jitsu/configurator/ssh"
	"github.com/jitsucom/jitsu/configurator/ssl"
	"github.com/jitsucom/jitsu/configurator/storages"
	enadapters "github.com/jitsucom/jitsu/server/adapters"
	config "github.com/jitsucom/jitsu/server/appconfig"
	"github.com/jitsucom/jitsu/server/logging"
	enmiddleware "github.com/jitsucom/jitsu/server/middleware"
	"github.com/jitsucom/jitsu/server/notifications"
	"github.com/jitsucom/jitsu/server/safego"
	"github.com/jitsucom/jitsu/server/telemetry"
	"github.com/spf13/viper"
	"math/rand"
	"os"
	"os/signal"
	"path/filepath"
	"runtime/debug"
	"strings"
	"syscall"

	"net/http"
	"time"
)

const (
	serviceName           = "Jitsu-Configurator"
	jitsuServerDefaultUrl = "http://host.docker.internal:8001"
)

var (
	configSource     = flag.String("cfg", "", "config file path")
	containerizedRun = flag.Bool("cr", false, "containerised run marker")
	dockerHubID      = flag.String("dhid", "", "ID of docker Hub")

	//ldflags
	commit  string
	tag     string
	builtAt string
)

type Version struct {
	Version string `json:"version"`
	BuiltAt string `json:"builtAt"`
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

	if err := config.Read(*configSource, *containerizedRun, "", "Jitsu Configurator"); err != nil {
		logging.Fatal("Error while reading application config:", err)
	}

	if err := appconfig.Init(*containerizedRun); err != nil {
		logging.Fatal(err)
	}

	//listen to shutdown signal to free up all resources
	ctx, cancel := context.WithCancel(context.Background())
	c := make(chan os.Signal, 1)
	signal.Notify(c, syscall.SIGTERM, syscall.SIGINT, syscall.SIGKILL, syscall.SIGHUP)
	go func() {
		<-c
		logging.Info("🤖 * Configurator is shutting down.. *")
		cancel()
		appconfig.Instance.Close()
		telemetry.Flush()
		time.Sleep(1 * time.Second)
		notifications.Close()
		telemetry.Close()
		os.Exit(0)
	}()

	environment := os.Getenv("ENVIRONMENT")
	if environment != "" {
		dockerHubID = &environment
	}

	telemetry.InitFromViper(serviceName, commit, tag, builtAt, *dockerHubID)

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
	configurationsStorage, err := storages.NewConfigurationsStorage(ctx, viper.GetViper())
	if err != nil {
		logging.Fatalf("Error creating configurations storage: %v", err)
	}

	configurationsService := storages.NewConfigurationsService(configurationsStorage, defaultPostgres)
	if err != nil {
		logging.Fatalf("Error creating configurations service: %v", err)
	}
	appconfig.Instance.ScheduleClosing(configurationsService)

	authService, err := authorization.NewService(ctx, viper.GetViper(), configurationsStorage)
	if err != nil {
		logging.Fatalf("Error creating authorization service: %v", err)
	}
	appconfig.Instance.ScheduleClosing(authService)

	//** Jitsu server configuration **
	jitsuConfig := &jitsu.Config{
		BaseURL:    viper.GetString("jitsu.base_url"),
		AdminToken: viper.GetString("jitsu.admin_token"),
	}
	//if full jitsu config is present
	if viper.IsSet("jitsu") {
		if err = viper.UnmarshalKey("jitsu", jitsuConfig); err != nil {
			logging.Fatalf("Error parsing 'jitsu' config: %v", err)
		}
	}
	if jitsuConfig.BaseURL == "" {
		logging.Infof("⚠️  'jitsu.base_url' parameter is not provided. Default value: `%s. Use configurator.yaml file or JITSU_SERVER_URL environment variable to provide desired value.", jitsuServerDefaultUrl)
		jitsuConfig.BaseURL = jitsuServerDefaultUrl
	}

	if err = jitsuConfig.Validate(); err != nil {
		logging.Fatalf("Error validating 'jitsu' config: %v", err)
	}

	jitsuService := jitsu.NewService(jitsuConfig.BaseURL, jitsuConfig.AdminToken)

	//** SSL **
	var sslUpdateExecutor *ssl.UpdateExecutor
	if jitsuConfig.SSL != nil {
		sshClient, err := ssh.NewSshClient(jitsuConfig.SSL.SSH.PrivateKeyPath, jitsuConfig.SSL.SSH.User)
		if err != nil {
			logging.Fatalf("Error creating SSH client: %v", err)
		}

		customDomainProcessor, err := ssl.NewCertificateService(sshClient, jitsuConfig.SSL.Hosts, configurationsService, jitsuConfig.SSL.ServerConfigTemplate, jitsuConfig.SSL.NginxConfigPath, jitsuConfig.SSL.AcmeChallengePath)

		sslUpdateExecutor = ssl.NewSSLUpdateExecutor(customDomainProcessor, jitsuConfig.SSL.Hosts, jitsuConfig.SSL.SSH.User, jitsuConfig.SSL.SSH.PrivateKeyPath, jitsuConfig.CName, jitsuConfig.SSL.CertificatePath, jitsuConfig.SSL.PKPath, jitsuConfig.SSL.AcmeChallengePath)
	}

	//** SMTP (email service) **
	var smtp *emails.SMTPConfiguration
	if viper.IsSet("smtp.host") {
		smtp = &emails.SMTPConfiguration{
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

	cors.Init(viper.GetString("server.domain"), viper.GetStringSlice("server.allowed_domains"))

	router := SetupRouter(jitsuService, configurationsStorage, configurationsService,
		authService, s3Config, sslUpdateExecutor, emailsService)
	notifications.ServerStart()
	logging.Info("⚙️  Started configurator: " + appconfig.Instance.Authority)
	server := &http.Server{
		Addr:              appconfig.Instance.Authority,
		Handler:           middleware.Cors(router),
		ReadTimeout:       time.Second * 60,
		ReadHeaderTimeout: time.Second * 60,
		IdleTimeout:       time.Second * 65,
	}
	logging.Fatal(server.ListenAndServe())
}

func SetupRouter(jitsuService *jitsu.Service, configurationsStorage storages.ConfigurationsStorage,
	configurationsService *storages.ConfigurationsService, authService *authorization.Service,
	defaultS3 *enadapters.S3Config, sslUpdateExecutor *ssl.UpdateExecutor, emailService *emails.Service) *gin.Engine {
	gin.SetMode(gin.ReleaseMode)
	router := gin.New()
	router.Use(gin.Recovery(), enmiddleware.GinLogErrorBody)
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
	if strings.HasPrefix(serverToken, "demo") {
		logging.Error("\t⚠️ Please replace server.auth (CLUSTER_ADMIN_TOKEN env variable) with any random string or uuid before deploying anything to production. Otherwise security of the platform can be compromised")
	}

	apiKeysHandler := handlers.NewAPIKeysHandler(configurationsService)

	enConfigurationsHandler := handlers.NewConfigurationsHandler(configurationsService, configurationsStorage)

	proxyHandler := handlers.NewProxyHandler(jitsuService, map[string]jitsu.APIDecorator{
		//write here custom decorators for certain HTTP URN paths
		"/proxy/api/v1/events/cache": jitsu.NewEventsCacheDecorator(configurationsService).Decorate,
		"/proxy/api/v1/statistics":   jitsu.NewStatisticsDecorator().Decorate,
	})
	router.Any("/proxy/*path", authenticatorMiddleware.ClientProjectAuth(proxyHandler.Handler))

	apiV1 := router.Group("/api/v1")
	{
		apiV1.POST("/notify", authenticatorMiddleware.ClientProjectAuth(handlers.NotifyHandler))
		apiV1.POST("/database", authenticatorMiddleware.ClientProjectAuth(handlers.NewDatabaseHandler(configurationsService).PostHandler))
		apiV1.POST("/apikeys/default", authenticatorMiddleware.ClientProjectAuth(apiKeysHandler.CreateDefaultAPIKeyHandler))

		apiV1.GET("/apikeys", middleware.ServerAuth(middleware.IfModifiedSince(apiKeysHandler.GetHandler, configurationsService.GetAPIKeysLastUpdated), serverToken))

		apiV1.GET("/jitsu/configuration", authenticatorMiddleware.ClientProjectAuth(handlers.NewConfigurationHandler(configurationsService).Handler))

		if sslUpdateExecutor != nil {
			apiV1.POST("/ssl", authenticatorMiddleware.ClientProjectAuth(handlers.NewCustomDomainHandler(sslUpdateExecutor).PerProjectHandler))
			apiV1.POST("/ssl/all", middleware.ServerAuth(handlers.NewCustomDomainHandler(sslUpdateExecutor).AllHandler, serverToken))
		}

		destinationsHandler := handlers.NewDestinationsHandler(configurationsService, defaultS3, jitsuService)
		apiV1.GET("/destinations", middleware.ServerAuth(middleware.IfModifiedSince(destinationsHandler.GetHandler, configurationsService.GetDestinationsLastUpdated), serverToken))
		apiV1.POST("/destinations/test", authenticatorMiddleware.ClientProjectAuth(destinationsHandler.TestHandler))

		sourcesHandler := handlers.NewSourcesHandler(configurationsService, jitsuService)
		apiV1.GET("/sources", middleware.ServerAuth(middleware.IfModifiedSince(sourcesHandler.GetHandler, configurationsService.GetSourcesLastUpdated), serverToken))
		apiV1.POST("/sources/test", authenticatorMiddleware.ClientProjectAuth(sourcesHandler.TestHandler))

		telemetryHandler := handlers.NewTelemetryHandler(configurationsService)
		apiV1.GET("/telemetry", middleware.ServerAuth(telemetryHandler.GetHandler, serverToken))

		apiV1.GET("/become", authenticatorMiddleware.ClientAuth(handlers.NewBecomeUserHandler(authService).Handler))

		apiV1.GET("/configurations/:collection", authenticatorMiddleware.ClientProjectAuth(enConfigurationsHandler.GetConfig))
		apiV1.POST("/configurations/:collection", authenticatorMiddleware.ClientProjectAuth(enConfigurationsHandler.StoreConfig))

		apiV1.GET("/system/configuration", handlers.NewSystemHandler(authService, configurationsService, emailService.IsConfigured(), viper.GetBool("server.self_hosted"), *dockerHubID).GetHandler)
		apiV1.GET("/system/version", func(c *gin.Context) {
			c.JSON(http.StatusOK, Version{tag, builtAt})
		})

		geoDataResolversHandler := handlers.NewGeoDataResolversHandler(configurationsService)
		apiV1.GET("/geo_data_resolvers", middleware.ServerAuth(middleware.IfModifiedSince(geoDataResolversHandler.GetHandler, configurationsService.GetGeoDataResolversLastUpdated), serverToken))

		usersAPIGroup := apiV1.Group("/users")
		{
			usersAPIGroup.GET("/info", authenticatorMiddleware.ClientAuth(enConfigurationsHandler.GetUserInfo))
			usersAPIGroup.POST("/info", authenticatorMiddleware.ClientAuth(enConfigurationsHandler.StoreUserInfo))
		}

		//authorization
		if authService.GetAuthorizationType() == authorization.RedisType {
			authHandler := handlers.NewAuthorizationHandler(authService, emailService, configurationsService)

			usersAPIGroup.POST("/signup", authHandler.SignUp)
			usersAPIGroup.POST("/onboarded/signup", authHandler.OnboardedSignUp)
			usersAPIGroup.POST("/signin", authHandler.SignIn)
			usersAPIGroup.POST("/signout", authenticatorMiddleware.ClientAuth(authHandler.SignOut))

			passwordAPIGroup := usersAPIGroup.Group("/password")
			{
				passwordAPIGroup.POST("/reset", authHandler.ResetPassword)
				passwordAPIGroup.POST("/change", authHandler.ChangePassword)
			}

			usersAPIGroup.POST("/token/refresh", authHandler.RefreshToken)
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
