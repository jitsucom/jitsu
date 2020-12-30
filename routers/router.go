package routers

import (
	"github.com/gin-gonic/gin"
	"github.com/jitsucom/eventnative/appconfig"
	"github.com/jitsucom/eventnative/caching"
	"github.com/jitsucom/eventnative/cluster"
	"github.com/jitsucom/eventnative/destinations"
	"github.com/jitsucom/eventnative/events"
	"github.com/jitsucom/eventnative/fallback"
	"github.com/jitsucom/eventnative/handlers"
	"github.com/jitsucom/eventnative/metrics"
	"github.com/jitsucom/eventnative/middleware"
	"github.com/jitsucom/eventnative/sources"
	"github.com/jitsucom/eventnative/users"
	"github.com/prometheus/client_golang/prometheus/promhttp"
	"github.com/spf13/viper"
	"net/http"
)

func SetupRouter(destinations *destinations.Service, adminToken string, clusterManager cluster.Manager, eventsCache *caching.EventsCache,
	inMemoryEventsCache *events.Cache, sources *sources.Service, fallbackService *fallback.Service, usersRecognitionService *users.RecognitionService) *gin.Engine {
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

	sourcesHandler := handlers.NewSourcesHandler(sources)
	fallbackHandler := handlers.NewFallbackHandler(fallbackService)
	dryRunHandler := handlers.NewDryRunHandler(destinations, events.NewJsPreprocessor())

	adminTokenMiddleware := middleware.AdminToken{Token: adminToken}
	apiV1 := router.Group("/api/v1")
	{
		apiV1.POST("/event", middleware.TokenFuncAuth(jsEventHandler.PostHandler, appconfig.Instance.AuthorizationService.GetClientOrigins, ""))
		apiV1.POST("/s2s/event", middleware.TokenTwoFuncAuth(apiEventHandler.PostHandler, appconfig.Instance.AuthorizationService.GetServerOrigins, appconfig.Instance.AuthorizationService.GetClientOrigins, "The token isn't a server token. Please use s2s integration token"))
		apiV1.POST("/event/dry-run", middleware.TokenTwoFuncAuth(dryRunHandler.Handle, appconfig.Instance.AuthorizationService.GetServerOrigins, appconfig.Instance.AuthorizationService.GetClientOrigins, ""))

		apiV1.POST("/destinations/test", adminTokenMiddleware.AdminAuth(handlers.DestinationsHandler, middleware.AdminTokenErr))
		apiV1.POST("/sources/:id/sync", adminTokenMiddleware.AdminAuth(sourcesHandler.SyncHandler, middleware.AdminTokenErr))
		apiV1.GET("/sources/:id/status", adminTokenMiddleware.AdminAuth(sourcesHandler.StatusHandler, middleware.AdminTokenErr))

		apiV1.GET("/cluster", adminTokenMiddleware.AdminAuth(handlers.NewClusterHandler(clusterManager).Handler, middleware.AdminTokenErr))
		apiV1.GET("/cache/events", adminTokenMiddleware.AdminAuth(jsEventHandler.OldGetHandler, middleware.AdminTokenErr))
		apiV1.GET("/events/cache", adminTokenMiddleware.AdminAuth(jsEventHandler.GetHandler, middleware.AdminTokenErr))

		apiV1.GET("/fallback", adminTokenMiddleware.AdminAuth(fallbackHandler.GetHandler, middleware.AdminTokenErr))
		apiV1.POST("/fallback/replay", adminTokenMiddleware.AdminAuth(fallbackHandler.ReplayHandler, middleware.AdminTokenErr))
	}

	router.POST("/api.:ignored", middleware.TokenFuncAuth(jsEventHandler.PostHandler, appconfig.Instance.AuthorizationService.GetClientOrigins, ""))

	if metrics.Enabled {
		router.GET("/prometheus", middleware.TokenAuth(gin.WrapH(promhttp.Handler()), adminToken))
	}

	return router
}
