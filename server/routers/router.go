package routers

import (
	"github.com/jitsucom/jitsu/server/geo"
	"github.com/jitsucom/jitsu/server/multiplexing"
	"github.com/jitsucom/jitsu/server/plugins"
	"github.com/jitsucom/jitsu/server/wal"
	"net/http"
	"net/http/pprof"

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
	"github.com/prometheus/client_golang/prometheus/promhttp"
	"github.com/spf13/viper"
)

func SetupRouter(adminToken string, metaStorage meta.Storage, destinations *destinations.Service, sourcesService *sources.Service, taskService *synchronization.TaskService,
	fallbackService *fallback.Service, clusterManager cluster.Manager, eventsCache *caching.EventsCache, systemService *system.Service,
	segmentEndpointFieldMapper, segmentCompatEndpointFieldMapper events.Mapper, processorHolder *events.ProcessorHolder,
	multiplexingService *multiplexing.Service, walService *wal.Service, geoService *geo.Service, pluginsRepository plugins.PluginsRepository) *gin.Engine {
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

	jsEventHandler := handlers.NewEventHandler(walService, multiplexingService, eventsCache, events.NewJitsuParser(), processorHolder.GetJSPreprocessor(), destinations, geoService)
	apiEventHandler := handlers.NewEventHandler(walService, multiplexingService, eventsCache, events.NewJitsuParser(), processorHolder.GetAPIPreprocessor(), destinations, geoService)
	segmentHandler := handlers.NewEventHandler(walService, multiplexingService, eventsCache, events.NewSegmentParser(segmentEndpointFieldMapper, appconfig.Instance.GlobalUniqueIDField), processorHolder.GetSegmentPreprocessor(), destinations, geoService)
	segmentCompatHandler := handlers.NewEventHandler(walService, multiplexingService, eventsCache, events.NewSegmentCompatParser(segmentCompatEndpointFieldMapper, appconfig.Instance.GlobalUniqueIDField), processorHolder.GetSegmentPreprocessor(), destinations, geoService)

	taskHandler := handlers.NewTaskHandler(taskService, sourcesService)
	fallbackHandler := handlers.NewFallbackHandler(fallbackService)
	dryRunHandler := handlers.NewDryRunHandler(destinations, processorHolder.GetJSPreprocessor(), geoService)
	statisticsHandler := handlers.NewStatisticsHandler(metaStorage)

	airbyteHandler := handlers.NewAirbyteHandler()
	sourcesHandler := handlers.NewSourcesHandler(sourcesService, metaStorage, destinations)
	pixelHandler := handlers.NewPixelHandler(multiplexingService, processorHolder.GetPixelPreprocessor(), destinations, geoService)

	bulkHandler := handlers.NewBulkHandler(destinations, processorHolder.GetBulkPreprocessor())

	geoDataResolverHandler := handlers.NewGeoDataResolverHandler(geoService)

	adminTokenMiddleware := middleware.AdminToken{Token: adminToken}
	apiV1 := router.Group("/api/v1")
	{
		//client endpoint
		apiV1.POST("/event", middleware.TokenFuncAuth(jsEventHandler.PostHandler, appconfig.Instance.AuthorizationService.GetClientOrigins, ""))
		apiV1.POST("/events", middleware.TokenFuncAuth(jsEventHandler.PostHandler, appconfig.Instance.AuthorizationService.GetClientOrigins, ""))
		//server endpoint
		apiV1.POST("/s2s/event", middleware.TokenTwoFuncAuth(apiEventHandler.PostHandler, appconfig.Instance.AuthorizationService.GetServerOrigins, appconfig.Instance.AuthorizationService.GetClientOrigins, "The token isn't a server secret token. Please use an s2s integration token"))
		apiV1.POST("/s2s/events", middleware.TokenTwoFuncAuth(apiEventHandler.PostHandler, appconfig.Instance.AuthorizationService.GetServerOrigins, appconfig.Instance.AuthorizationService.GetClientOrigins, "The token isn't a server secret token. Please use an s2s integration token"))
		//Segment API
		apiV1.POST("/segment/v1/batch", middleware.TokenFuncAuth(segmentHandler.PostHandler, appconfig.Instance.AuthorizationService.GetServerOrigins, ""))
		apiV1.POST("/segment", middleware.TokenFuncAuth(segmentHandler.PostHandler, appconfig.Instance.AuthorizationService.GetServerOrigins, ""))
		//Segment compat API
		apiV1.POST("/segment/compat/v1/batch", middleware.TokenFuncAuth(segmentCompatHandler.PostHandler, appconfig.Instance.AuthorizationService.GetServerOrigins, ""))
		apiV1.POST("/segment/compat", middleware.TokenFuncAuth(segmentCompatHandler.PostHandler, appconfig.Instance.AuthorizationService.GetServerOrigins, ""))
		//Tracking pixel API
		apiV1.GET("/p.gif", pixelHandler.Handle)
		//bulk endpoint
		apiV1.POST("/events/bulk", middleware.TokenTwoFuncAuth(bulkHandler.BulkLoadingHandler, appconfig.Instance.AuthorizationService.GetServerOrigins, appconfig.Instance.AuthorizationService.GetClientOrigins, "The token isn't a server token. Please use an s2s integration token"))

		//Dry run
		apiV1.POST("/events/dry-run", middleware.TokenTwoFuncAuth(dryRunHandler.Handle, appconfig.Instance.AuthorizationService.GetServerOrigins, appconfig.Instance.AuthorizationService.GetClientOrigins, ""))

		apiV1.GET("/geo_data_resolvers/editions", adminTokenMiddleware.AdminAuth(geoDataResolverHandler.EditionsHandler))
		apiV1.POST("/geo_data_resolvers/test", adminTokenMiddleware.AdminAuth(geoDataResolverHandler.TestHandler))
		apiV1.POST("/destinations/test", adminTokenMiddleware.AdminAuth(handlers.DestinationsHandler))
		apiV1.POST("/templates/evaluate", adminTokenMiddleware.AdminAuth(handlers.NewEventTemplateHandler(pluginsRepository).Handler))

		sourcesRoute := apiV1.Group("/sources")
		{
			sourcesRoute.POST("/test", adminTokenMiddleware.AdminAuth(sourcesHandler.TestSourcesHandler))
			sourcesRoute.POST("/clear_cache", adminTokenMiddleware.AdminAuth(sourcesHandler.ClearCacheHandler))
			sourcesRoute.GET("/oauth_fields/:sourceType", adminTokenMiddleware.AdminAuth(sourcesHandler.OauthFields))
		}

		//536-issue DEPRECATED
		apiV1.GET("/statistics", adminTokenMiddleware.AdminAuth(statisticsHandler.DeprecatedGetHandler))

		apiV1.GET("/statistics/detailed", adminTokenMiddleware.AdminAuth(statisticsHandler.GetHandler))

		apiV1.GET("/tasks", adminTokenMiddleware.AdminAuth(taskHandler.GetAllHandler))
		apiV1.GET("/tasks/:taskID", adminTokenMiddleware.AdminAuth(taskHandler.GetByIDHandler))
		apiV1.POST("/tasks", adminTokenMiddleware.AdminAuth(taskHandler.SyncHandler))
		apiV1.GET("/tasks/:taskID/logs", adminTokenMiddleware.AdminAuth(taskHandler.TaskLogsHandler))
		apiV1.POST("/tasks/:taskID/cancel", adminTokenMiddleware.AdminAuth(taskHandler.TaskCancelHandler))

		apiV1.GET("/cluster", adminTokenMiddleware.AdminAuth(handlers.NewClusterHandler(clusterManager).Handler))
		apiV1.GET("/events/cache", adminTokenMiddleware.AdminAuth(jsEventHandler.GetHandler))

		apiV1.GET("/fallback", adminTokenMiddleware.AdminAuth(fallbackHandler.GetHandler))
		apiV1.POST("/replay", adminTokenMiddleware.AdminAuth(fallbackHandler.ReplayHandler))

		apiV1.GET("/airbyte/:dockerImageName/spec", adminTokenMiddleware.AdminAuth(airbyteHandler.SpecHandler))
		apiV1.GET("/airbyte/:dockerImageName/versions", adminTokenMiddleware.AdminAuth(airbyteHandler.VersionsHandler))
		apiV1.POST("/airbyte/:dockerImageName/catalog", adminTokenMiddleware.AdminAuth(airbyteHandler.CatalogHandler))

		apiV1.POST("/singer/:tap/catalog", adminTokenMiddleware.AdminAuth(handlers.NewSingerHandler(metaStorage).CatalogHandler))
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
