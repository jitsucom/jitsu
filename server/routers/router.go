package routers

import (
	"github.com/gin-gonic/gin"
	"github.com/jitsucom/eventnative/server/appconfig"
	"github.com/jitsucom/eventnative/server/caching"
	"github.com/jitsucom/eventnative/server/cluster"
	"github.com/jitsucom/eventnative/server/destinations"
	"github.com/jitsucom/eventnative/server/events"
	"github.com/jitsucom/eventnative/server/fallback"
	"github.com/jitsucom/eventnative/server/handlers"
	"github.com/jitsucom/eventnative/server/metrics"
	"github.com/jitsucom/eventnative/server/middleware"
	"github.com/jitsucom/eventnative/server/sources"
	"github.com/jitsucom/eventnative/server/synchronization"
	"github.com/jitsucom/eventnative/server/users"
	"github.com/prometheus/client_golang/prometheus/promhttp"
	"github.com/spf13/viper"
	"net/http"
	"net/http/pprof"
)

func SetupRouter(adminToken string, destinations *destinations.Service, sourcesService *sources.Service, taskService *synchronization.TaskService,
	usersRecognitionService *users.RecognitionService, fallbackService *fallback.Service, clusterManager cluster.Manager,
	eventsCache *caching.EventsCache, inMemoryEventsCache *events.Cache) *gin.Engine {
	gin.SetMode(gin.ReleaseMode)

	router := gin.New() //gin.Default()
	router.Use(gin.Recovery())

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

	jsEventHandler := handlers.NewEventHandler(destinations, events.NewJsPreprocessor(), eventsCache, inMemoryEventsCache, usersRecognitionService)
	apiEventHandler := handlers.NewEventHandler(destinations, events.NewApiPreprocessor(), eventsCache, inMemoryEventsCache, usersRecognitionService)

	taskHandler := handlers.NewTaskHandler(taskService, sourcesService)
	fallbackHandler := handlers.NewFallbackHandler(fallbackService)
	dryRunHandler := handlers.NewDryRunHandler(destinations, events.NewJsPreprocessor())

	adminTokenMiddleware := middleware.AdminToken{Token: adminToken}
	apiV1 := router.Group("/api/v1")
	{
		apiV1.POST("/event", middleware.TokenFuncAuth(jsEventHandler.PostHandler, appconfig.Instance.AuthorizationService.GetClientOrigins, ""))
		apiV1.POST("/s2s/event", middleware.TokenTwoFuncAuth(apiEventHandler.PostHandler, appconfig.Instance.AuthorizationService.GetServerOrigins, appconfig.Instance.AuthorizationService.GetClientOrigins, "The token isn't a server token. Please use s2s integration token"))
		apiV1.POST("/events/dry-run", middleware.TokenTwoFuncAuth(dryRunHandler.Handle, appconfig.Instance.AuthorizationService.GetServerOrigins, appconfig.Instance.AuthorizationService.GetClientOrigins, ""))

		apiV1.POST("/destinations/test", adminTokenMiddleware.AdminAuth(handlers.DestinationsHandler))

		tasksRoute := apiV1.Group("/tasks")
		{
			tasksRoute.GET("/", adminTokenMiddleware.AdminAuth(taskHandler.GetAllHandler))
			tasksRoute.GET("/:taskId", adminTokenMiddleware.AdminAuth(taskHandler.GetByIDHandler))
			tasksRoute.POST("/", adminTokenMiddleware.AdminAuth(taskHandler.SyncHandler))
			tasksRoute.GET("/:taskId/logs", adminTokenMiddleware.AdminAuth(taskHandler.TaskLogsHandler))
		}

		apiV1.GET("/cluster", adminTokenMiddleware.AdminAuth(handlers.NewClusterHandler(clusterManager).Handler))
		apiV1.GET("/cache/events", adminTokenMiddleware.AdminAuth(jsEventHandler.OldGetHandler))
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
