package main

import (
	"context"
	"encoding/json"
	"flag"
	"io"
	"math/rand"
	"os"
	"os/signal"
	"path/filepath"
	"runtime/debug"
	"strings"
	"syscall"

	"github.com/gin-gonic/contrib/static"
	"github.com/gin-gonic/gin"
	"github.com/gin-gonic/gin/binding"
	"github.com/go-playground/validator/v10"
	"github.com/jitsucom/jitsu/configurator/appconfig"
	"github.com/jitsucom/jitsu/configurator/authorization"
	"github.com/jitsucom/jitsu/configurator/cors"
	"github.com/jitsucom/jitsu/configurator/destinations"
	"github.com/jitsucom/jitsu/configurator/emails"
	"github.com/jitsucom/jitsu/configurator/handlers"
	"github.com/jitsucom/jitsu/configurator/jitsu"
	"github.com/jitsucom/jitsu/configurator/middleware"
	"github.com/jitsucom/jitsu/configurator/openapi"
	"github.com/jitsucom/jitsu/configurator/ssh"
	"github.com/jitsucom/jitsu/configurator/ssl"
	"github.com/jitsucom/jitsu/configurator/storages"
	enadapters "github.com/jitsucom/jitsu/server/adapters"
	config "github.com/jitsucom/jitsu/server/appconfig"
	"github.com/jitsucom/jitsu/server/locks"
	locksinmemory "github.com/jitsucom/jitsu/server/locks/inmemory"
	locksredis "github.com/jitsucom/jitsu/server/locks/redis"
	"github.com/jitsucom/jitsu/server/logging"
	"github.com/jitsucom/jitsu/server/meta"
	enmiddleware "github.com/jitsucom/jitsu/server/middleware"
	"github.com/jitsucom/jitsu/server/notifications"
	"github.com/jitsucom/jitsu/server/runtime"
	"github.com/jitsucom/jitsu/server/safego"
	"github.com/jitsucom/jitsu/server/telemetry"
	"github.com/pkg/errors"
	"github.com/spf13/viper"

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

type Authorizator interface {
	middleware.Authorizator
	handlers.Authorizator
}

//go:generate oapi-codegen -templates ../../openapi/templates -generate gin -package openapi -o openapi/routers-gen.go ../../openapi/configurator.yaml
//go:generate oapi-codegen -templates ../../openapi/templates -generate types -package openapi -o openapi/types-gen.go ../../openapi/configurator.yaml
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
		notifications.Flush()
		time.Sleep(1 * time.Second)
		notifications.Close()
		appconfig.Instance.CloseLast()
		telemetry.Close()
		os.Exit(0)
	}()

	environment := os.Getenv("ENVIRONMENT")
	if environment != "" {
		dockerHubID = &environment
	}

	telemetrySourceURL := viper.GetString("server.telemetry")
	telemetry.InitFromViper(telemetrySourceURL, serviceName, commit, tag, builtAt, *dockerHubID)

	safego.GlobalRecoverHandler = func(value interface{}) {
		logging.Error("panic")
		logging.Error(value)
		logging.Error(string(debug.Stack()))
		notifications.SystemErrorf("Panic:\n%s\n%s", value, string(debug.Stack()))
	}

	//** Slack Notifications **
	slackNotificationsWebHook := viper.GetString("notifications.slack.url")
	if slackNotificationsWebHook != "" {
		notifications.Init(serviceName, tag, slackNotificationsWebHook, appconfig.Instance.ServerName, logging.Errorf)
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
	configurationsStorage, redisPoolFactory, err := initializeStorage(viper.GetViper())
	if err != nil {
		logging.Fatalf("Error creating configurations storage: %v", err)
	}

	var lockFactory locks.LockFactory
	var redisPool *meta.RedisPool
	var locksCloser io.Closer
	if redisPoolFactory != nil {
		options := redisPoolFactory.GetOptions()
		options.MaxActive = 100
		redisPoolFactory.WithOptions(options)

		redisPool, err = redisPoolFactory.Create()
		if err != nil {
			logging.Fatalf("Error creating redis pool for locks: %v", err)
		}
		lockFactory, locksCloser = locksredis.NewLockFactory(ctx, redisPool)
	} else {
		//in case of firebase installation
		lockFactory, locksCloser = locksinmemory.NewLockFactory()
	}
	appconfig.Instance.ScheduleLastClosing(locksCloser)
	if redisPool != nil {
		appconfig.Instance.ScheduleLastClosing(redisPool)
	}

	configurationsService := storages.NewConfigurationsService(configurationsStorage, defaultPostgres, lockFactory)
	if err != nil {
		logging.Fatalf("Error creating configurations service: %v", err)
	}
	appconfig.Instance.ScheduleClosing(configurationsService)

	//** SMTP (email service) **
	emailsService, err := newEmailService(viper.GetViper())
	if err != nil {
		logging.Fatalf("Error creating emails service: %v", err)
	}

	authorizator, err := newAuthorizator(ctx, viper.GetViper(), emailsService)
	if err != nil {
		logging.Fatalf("Error creating authorization service: %v", err)
	}
	appconfig.Instance.ScheduleClosing(authorizator)
	ssoProvider := newSSOProvider(viper.GetViper())
	appconfig.Instance.ScheduleClosing(ssoProvider)

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
	} else {
		customDomainProcessor, _ := ssl.NewCertificateService(nil, nil, configurationsService, "", "", "")
		sslUpdateExecutor = ssl.NewSSLUpdateExecutor(customDomainProcessor, nil, "", "", "", "", "", "")
	}

	cors.Init(viper.GetString("server.domain"), viper.GetStringSlice("server.allowed_domains"))

	router := SetupRouter(jitsuService, configurationsService,
		authorizator, ssoProvider, s3Config, sslUpdateExecutor, emailsService)

	notifications.ServerStart(runtime.GetInfo())
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

func newEmailService(vp *viper.Viper) (*emails.Service, error) {
	var config emails.SMTPConfiguration
	if data := os.Getenv("JITSU_SMTP_CONFIG"); data != "" {
		if err := json.Unmarshal([]byte(data), &config); err != nil {
			return nil, errors.Wrap(err, "unmarshal smtp config")
		}
	} else if vp.IsSet("smtp.host") {
		config = emails.SMTPConfiguration{
			Host:      viper.GetString("smtp.host"),
			Port:      viper.GetInt("smtp.port"),
			User:      viper.GetString("smtp.user"),
			Password:  viper.GetString("smtp.password"),
			From:      viper.GetString("smtp.from"),
			Signature: viper.GetString("smtp.signature"),
			ReplyTo:   viper.GetString("smtp.reply_to"),
		}
	} else {
		return nil, nil
	}

	if err := config.Validate(); err != nil {
		return nil, errors.Wrap(err, "validate smtp config")
	}

	return emails.NewService(&config)
}

func newSSOProvider(vp *viper.Viper) handlers.SSOProvider {
	var config authorization.SSOConfig
	if data := os.Getenv("JITSU_SSO_CONFIG"); data != "" {
		if err := json.Unmarshal([]byte(data), &config); err != nil {
			logging.Errorf("Can't unmarshal JITSU_SSO_CONFIG from env variables: %v", err)
			return nil
		}
	} else if vp := vp.Sub("sso"); vp != nil {
		autoProvisionConfig := authorization.SSOConfigAutoProvision{
			Enable:         vp.GetBool("auto_provision.enable"),
			AutoOnboarding: vp.GetBool("auto_provision.auto_onboarding"),
		}
		config = authorization.SSOConfig{
			Provider:              vp.GetString("provider"),
			Tenant:                vp.GetString("tenant"),
			Product:               vp.GetString("product"),
			Host:                  vp.GetString("host"),
			AccessTokenTTLSeconds: vp.GetInt("access_token_ttl_seconds"),
			AutoProvision:         autoProvisionConfig,
		}
	} else {
		logging.Info("No SSO config provided, skipping initialize SSO Auth")
		return nil
	}

	if err := validator.New().Struct(&config); err != nil {
		logging.Errorf("Missed required SSO config params: %v", err)
		return nil
	}

	switch config.Provider {
	case authorization.BoxyHQName:
		return &authorization.BoxyHQ{Config: &config}
	default:
		logging.Errorf("SSO provider %s is not supported. Jitsu supports only: %s",
			config.Provider, authorization.BoxyHQName)
		return nil
	}
}

func newAuthorizator(ctx context.Context, vp *viper.Viper, mailSender authorization.MailSender) (Authorizator, error) {
	if vp.IsSet("auth.firebase.project_id") {
		return authorization.NewFirebase(ctx, authorization.FirebaseInit{
			ProjectID:       vp.GetString("auth.firebase.project_id"),
			CredentialsFile: vp.GetString("auth.firebase.credentials_file"),
			AdminDomain:     vp.GetString("auth.admin_domain"),
			AdminEmails:     vp.GetStringSlice("auth.admin_users"),
			MailSender:      mailSender,
		})
	} else if vp.IsSet("auth.redis.host") {
		host := vp.GetString("auth.redis.host")
		if host == "" {
			return nil, errors.New("auth.redis.host is required")
		}

		port := vp.GetInt("auth.redis.port")
		sentinelMaster := vp.GetString("auth.redis.sentinel_master_name")
		redisPassword := vp.GetString("auth.redis.password")
		redisDatabase := vp.GetInt("auth.redis.database")

		tlsSkipVerify := vp.GetBool("auth.redis.tls_skip_verify")
		redisPoolFactory := meta.NewRedisPoolFactory(host, port, redisPassword, redisDatabase, tlsSkipVerify, sentinelMaster)
		if defaultPort, ok := redisPoolFactory.CheckAndSetDefaultPort(); ok {
			logging.Infof("auth.redis.port isn't configured. Will be used default: %d", defaultPort)
		}

		return authorization.NewRedis(authorization.RedisInit{
			PoolFactory: redisPoolFactory,
			MailSender:  mailSender,
		})
	} else {
		return nil, errors.New("Unknown 'auth' section type. Supported: firebase, redis")
	}
}

func SetupRouter(jitsuService *jitsu.Service, configurationsService *storages.ConfigurationsService,
	authorizator Authorizator, ssoProvider handlers.SSOProvider, defaultS3 *enadapters.S3Config, sslUpdateExecutor *ssl.UpdateExecutor,
	emailService *emails.Service) *gin.Engine {
	gin.SetMode(gin.ReleaseMode)
	router := gin.New()
	router.Use(gin.Recovery(), enmiddleware.GinLogErrorBody)
	router.Use(gin.CustomRecovery(func(c *gin.Context, recovered interface{}) {
		logging.SystemErrorf("Panic on request %s: %v\n%s", c.Request.URL.String(), recovered, string(debug.Stack()))
		logging.Errorf("%v", *c.Request)
		c.JSON(http.StatusInternalServerError, enmiddleware.ErrResponse("System error", nil))
	}))

	router.Use(static.Serve("/", static.LocalFile("./web", true)))
	router.NoRoute(func(c *gin.Context) {
		c.File("./web/index.html")
	})

	serverToken := viper.GetString("server.auth")
	if strings.HasPrefix(serverToken, "demo") {
		logging.Warn("\t⚠️ Please replace server.auth (CLUSTER_ADMIN_TOKEN env variable) with any random string or uuid before deploying anything to production. Otherwise security of the platform can be compromised")
	}
	isSelfHosted := viper.GetBool("server.self_hosted")
	authenticatorMiddleware := &middleware.AuthorizationInterceptor{
		ServerToken:    serverToken,
		Authorizator:   authorizator,
		IsSelfHosted:   isSelfHosted,
		Configurations: configurationsService,
	}
	contentChangesMiddleware := middleware.NewContentChanges(map[string]func() (*time.Time, error){
		"/api/v1/apikeys":            configurationsService.GetAPIKeysLastUpdated,
		"/api/v1/destinations":       configurationsService.GetDestinationsLastUpdated,
		"/api/v1/sources":            configurationsService.GetSourcesLastUpdated,
		"/api/v1/geo_data_resolvers": configurationsService.GetGeoDataResolversLastUpdated,
	})

	router.GET("/ping", func(c *gin.Context) {
		c.String(http.StatusOK, "pong")
	})

	ssoAuthHandler := &handlers.SSOAuthHandler{
		Authorizator:   authorizator,
		Provider:       ssoProvider,
		UIBaseURL:      viper.GetString("ui.base_url"),
		Configurations: configurationsService,
	}

	router.GET("/api/v1/sso-auth-callback", ssoAuthHandler.Handle)

	proxyHandler := handlers.NewProxyHandler(jitsuService, map[string]jitsu.APIDecorator{
		//write here custom decorators for a certain HTTP URN paths
		"/proxy/api/v1/events/cache":        jitsu.NewEventsCacheDecorator(configurationsService).Decorate,
		"/proxy/api/v1/statistics":          jitsu.NewStatisticsDecorator().Decorate,
		"/proxy/api/v1/statistics/detailed": jitsu.NewStatisticsDecorator().Decorate,
	})
	router.Any("/proxy/*path", authenticatorMiddleware.ManagementWrapper(proxyHandler.Handler))

	router.Any("/check_domain", authenticatorMiddleware.ManagementWrapper(func(c *gin.Context) {
		if sslUpdateExecutor.CheckDomain(c.Query("domain")) {
			c.Status(http.StatusOK)
		} else {
			c.Status(http.StatusForbidden)
		}
	}))

	// ** OLD API (delete after migrating UI to api/v2) **
	jConfigurationsHandler := handlers.NewConfigurationsHandler(configurationsService)
	apiV1 := router.Group("/api/v1")
	{

		//DEPRECATED
		apiV1.GET("/configurations/:collection", authenticatorMiddleware.ManagementWrapper(jConfigurationsHandler.GetConfig))
		apiV1.POST("/configurations/:collection", authenticatorMiddleware.ManagementWrapper(jConfigurationsHandler.StoreConfig))
	}

	// ** New API generated by OpenAPI
	openAPIHandler := &handlers.OpenAPI{
		Authorizator:   authorizator,
		SSOProvider:    ssoProvider,
		Configurations: configurationsService,
		SystemConfig: &handlers.SystemConfiguration{
			SMTP:        emailService.IsConfigured(),
			SelfHosted:  isSelfHosted,
			DockerHUBID: *dockerHubID,
			Tag:         tag,
			BuiltAt:     builtAt,
		},
		JitsuService:   jitsuService,
		UpdateExecutor: sslUpdateExecutor,
		DefaultS3:      defaultS3,
	}

	return openapi.RegisterHandlersWithOptions(router, openAPIHandler, openapi.GinServerOptions{
		BaseURL:     "",
		Middlewares: []openapi.MiddlewareFunc{authenticatorMiddleware.Intercept, contentChangesMiddleware.IfModifiedSince},
	})
}

func initializeStorage(vp *viper.Viper) (storages.ConfigurationsStorage, *meta.RedisPoolFactory, error) {
	if vp.IsSet("storage.redis.host") {
		host := vp.GetString("storage.redis.host")
		if host == "" {
			return nil, nil, errors.New("storage.redis.host must not be empty")
		}

		port := vp.GetInt("storage.redis.port")
		password := vp.GetString("storage.redis.password")
		database := vp.GetInt("storage.redis.database")

		tlsSkipVerify := vp.GetBool("storage.redis.tls_skip_verify")
		sentinelMaster := vp.GetString("storage.redis.sentinel_master_name")

		redisPoolFactory := meta.NewRedisPoolFactory(host, port, password, database, tlsSkipVerify, sentinelMaster)
		if defaultPort, ok := redisPoolFactory.CheckAndSetDefaultPort(); ok {
			logging.Infof("storage.redis.port isn't configured. Will be used default: %d", defaultPort)
		}

		redisService, err := storages.NewRedis(redisPoolFactory)
		return redisService, redisPoolFactory, err
	} else {
		return nil, nil, errors.New("Unknown 'storage' section type. Supported: redis")
	}
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
