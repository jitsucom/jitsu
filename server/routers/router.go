package routers

import (
	"github.com/gin-gonic/gin"
	"github.com/jitsucom/jitsu/server/appconfig"
	"github.com/jitsucom/jitsu/server/caching"
	"github.com/jitsucom/jitsu/server/cluster"
	"github.com/jitsucom/jitsu/server/destinations"
	"github.com/jitsucom/jitsu/server/events"
	"github.com/jitsucom/jitsu/server/fallback"
	"github.com/jitsucom/jitsu/server/handlers"
	"github.com/jitsucom/jitsu/server/meta"
	"github.com/jitsucom/jitsu/server/metrics"
	"github.com/jitsucom/jitsu/server/middleware"
	"github.com/jitsucom/jitsu/server/sources"
	"github.com/jitsucom/jitsu/server/synchronization"
	"github.com/jitsucom/jitsu/server/system"
	"github.com/jitsucom/jitsu/server/users"
	"github.com/prometheus/client_golang/prometheus/promhttp"
	"github.com/spf13/viper"
	"net/http"
	"net/http/pprof"
)

func SetupRouter(adminToken string, metaStorage meta.Storage, destinations *destinations.Service, sourcesService *sources.Service, taskService *synchronization.TaskService,
	usersRecognitionService *users.RecognitionService, fallbackService *fallback.Service, clusterManager cluster.Manager,
	eventsCache *caching.EventsCache, systemService *system.Service, segmentEndpointFieldMapper, segmentCompatEndpointFieldMapper events.Mapper) *gin.Engine {
	gin.SetMode(gin.ReleaseMode)

	router := gin.New() //gin.Default()
	router.Use(gin.Recovery())

	router.GET("/ping", func(c *gin.Context) {
		c.String(http.StatusOK, "pong")
	})

	publicURL := viper.GetString("server.public_url")
	configuratorURL := viper.GetString("server.configurator_url")

	rootPathHandler := handlers.NewRootPathHandler(systemService, viper.GetString("server.static_files_dir"), configuratorURL,
		viper.GetBool("server.disable_welcome_page"), viper.GetBool("server.configurator_redirect_https"))
	router.GET("/", rootPathHandler.Handler)

	staticHandler := handlers.NewStaticHandler(viper.GetString("server.static_files_dir"), publicURL)
	router.GET("/s/:filename", staticHandler.Handler)
	router.GET("/t/:filename", staticHandler.Handler)

	jsEventHandler := handlers.NewEventHandler(destinations, events.NewJitsuParser(), events.NewJsProcessor(usersRecognitionService, viper.GetString("server.fields_configuration.user_agent_path")), eventsCache)
	apiEventHandler := handlers.NewEventHandler(destinations, events.NewJitsuParser(), events.NewAPIProcessor(), eventsCache)
	segmentHandler := handlers.NewEventHandler(destinations, events.NewSegmentParser(segmentEndpointFieldMapper, appconfig.Instance.GlobalUniqueIDField), events.NewSegmentProcessor(usersRecognitionService), eventsCache)
	segmentCompatHandler := handlers.NewEventHandler(destinations, events.NewSegmentCompatParser(segmentCompatEndpointFieldMapper, appconfig.Instance.GlobalUniqueIDField), events.NewSegmentProcessor(usersRecognitionService), eventsCache)

	taskHandler := handlers.NewTaskHandler(taskService, sourcesService)
	fallbackHandler := handlers.NewFallbackHandler(fallbackService)
	dryRunHandler := handlers.NewDryRunHandler(destinations, events.NewJsProcessor(usersRecognitionService, viper.GetString("server.fields_configuration.user_agent_path")))
	statisticsHandler := handlers.NewStatisticsHandler(metaStorage)

	sourcesHandler := handlers.NewSourcesHandler(sourcesService, metaStorage)

	adminTokenMiddleware := middleware.AdminToken{Token: adminToken}
	apiV1 := router.Group("/api/v1")
	{
		//client endpoint
		apiV1.POST("/event", middleware.TokenFuncAuth(jsEventHandler.PostHandler, appconfig.Instance.AuthorizationService.GetClientOrigins, ""))
		//server endpoint
		apiV1.POST("/s2s/event", middleware.TokenTwoFuncAuth(apiEventHandler.PostHandler, appconfig.Instance.AuthorizationService.GetServerOrigins, appconfig.Instance.AuthorizationService.GetClientOrigins, "The token isn't a server token. Please use s2s integration token"))
		//Segment API
		apiV1.POST("/segment/v1/batch", middleware.TokenFuncAuth(segmentHandler.PostHandler, appconfig.Instance.AuthorizationService.GetServerOrigins, ""))
		apiV1.POST("/segment", middleware.TokenFuncAuth(segmentHandler.PostHandler, appconfig.Instance.AuthorizationService.GetServerOrigins, ""))
		//Segment compat API
		apiV1.POST("/segment/compat/v1/batch", middleware.TokenFuncAuth(segmentCompatHandler.PostHandler, appconfig.Instance.AuthorizationService.GetServerOrigins, ""))
		apiV1.POST("/segment/compat", middleware.TokenFuncAuth(segmentCompatHandler.PostHandler, appconfig.Instance.AuthorizationService.GetServerOrigins, ""))
		//Dry run
		apiV1.POST("/events/dry-run", middleware.TokenTwoFuncAuth(dryRunHandler.Handle, appconfig.Instance.AuthorizationService.GetServerOrigins, appconfig.Instance.AuthorizationService.GetClientOrigins, ""))

		apiV1.POST("/destinations/test", adminTokenMiddleware.AdminAuth(handlers.DestinationsHandler))
		apiV1.POST("/templates/evaluate", adminTokenMiddleware.AdminAuth(handlers.EventTemplateHandler))

		sourcesRoute := apiV1.Group("/sources")
		{
			sourcesRoute.POST("/test", adminTokenMiddleware.AdminAuth(sourcesHandler.TestSourcesHandler))
			sourcesRoute.POST("/clear_cache", adminTokenMiddleware.AdminAuth(sourcesHandler.ClearCacheHandler))
		}

		apiV1.GET("/statistics", adminTokenMiddleware.AdminAuth(statisticsHandler.GetHandler))

		tasksRoute := apiV1.Group("/tasks")
		{
			tasksRoute.GET("/", adminTokenMiddleware.AdminAuth(taskHandler.GetAllHandler))
			tasksRoute.GET("/:taskID", adminTokenMiddleware.AdminAuth(taskHandler.GetByIDHandler))
			tasksRoute.POST("/", adminTokenMiddleware.AdminAuth(taskHandler.SyncHandler))
			tasksRoute.GET("/:taskID/logs", adminTokenMiddleware.AdminAuth(taskHandler.TaskLogsHandler))
		}

		apiV1.GET("/cluster", adminTokenMiddleware.AdminAuth(handlers.NewClusterHandler(clusterManager).Handler))
		apiV1.GET("/events/cache", adminTokenMiddleware.AdminAuth(jsEventHandler.GetHandler))

		apiV1.GET("/fallback", adminTokenMiddleware.AdminAuth(fallbackHandler.GetHandler))
		apiV1.POST("/replay", adminTokenMiddleware.AdminAuth(fallbackHandler.ReplayHandler))
	}

	router.POST("/api.:ignored", middleware.TokenFuncAuth(jsEventHandler.PostHandler, appconfig.Instance.AuthorizationService.GetClientOrigins, ""))

	if metrics.Enabled {
		router.GET("/prometheus", middleware.TokenAuth(gin.WrapH(promhttp.Handler()), adminToken))
	}

	//Setup profiler
	statsPprof := router.Group("/stats/pprof")
	{
		statsPprof.GET("/allocs", adminTokenMiddleware.AdminAuth(gin.WrapF(pprof.Handler("allocs").ServeHTTP)))
		statsPprof.GET("/block", adminTokenMiddleware.AdminAuth(gin.WrapF(pprof.Handler("block").ServeHTTP)))
		statsPprof.GET("/goroutine", adminTokenMiddleware.AdminAuth(gin.WrapF(pprof.Handler("goroutine").ServeHTTP)))
		statsPprof.GET("/heap", adminTokenMiddleware.AdminAuth(gin.WrapF(pprof.Handler("heap").ServeHTTP)))
		statsPprof.GET("/mutex", adminTokenMiddleware.AdminAuth(gin.WrapF(pprof.Handler("mutex").ServeHTTP)))
		statsPprof.GET("/threadcreate", adminTokenMiddleware.AdminAuth(gin.WrapF(pprof.Handler("threadcreate").ServeHTTP)))
	}

	return router
}
