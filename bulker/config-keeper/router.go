package main

import (
	"fmt"
	"github.com/gin-gonic/gin"
	"github.com/jitsucom/bulker/jitsubase/appbase"
	"github.com/jitsucom/bulker/jitsubase/utils"
	"net/http"
	"os"
	"strings"
	"time"
)

type Router struct {
	*appbase.Router
	appContext *Context
}

func NewRouter(appContext *Context) *Router {
	base := appbase.NewRouterBase(appContext.config.Config, []string{"/health", "/p.js"})

	router := &Router{
		Router:     base,
		appContext: appContext,
	}
	engine := router.Engine()
	engine.GET("/p.js", router.ScriptHandler)
	engine.GET("/:repository", router.RepositoryHandler)
	// operator confirmation for an intended mass config change: makes the
	// repository's circuit breaker accept the next generation (JITSU-182).
	// Bearer-token protected like every non-exempt route
	engine.POST("/breaker/:repository/accept", func(c *gin.Context) {
		repName := c.Param("repository")
		breaker, ok := appContext.breakers[repName]
		if !ok {
			c.JSON(http.StatusNotFound, gin.H{"error": fmt.Sprintf("no circuit breaker for repository %s", repName)})
			return
		}
		breaker.AcceptNext()
		hostname, _ := os.Hostname()
		router.Infof("Circuit breaker for %s: operator requested acceptance of the next generation (replica %s)", repName, hostname)
		// pod is included so operators can confirm which replica accepted —
		// each replica keeps its own baseline and must be accepted separately
		c.JSON(http.StatusOK, gin.H{"status": "ok", "repository": repName, "held": breaker.Held(), "pod": hostname})
	})

	engine.GET("/health", func(c *gin.Context) {
		reps := utils.JoinNonEmptyStrings(",", appContext.config.Repositories, "p.js")
		healthy := true
		repStatuses := map[string]any{}
		now := time.Now()
		for _, rep := range strings.Split(reps, ",") {
			repository, ok := appContext.repositories[rep]
			if !ok {
				healthy = false
				repStatuses[rep] = map[string]any{"error": "not_found"}
				continue
			}
			if !repository.Loaded() {
				healthy = false
			}
			// a held repository (circuit breaker keeping last-known-good,
			// JITSU-182) is deliberately NOT unhealthy: it serves good data,
			// and failing liveness would just restart pods into the same held
			// state. The held flag below + the "System error:" log are the signal
			if breaker, guarded := appContext.breakers[rep]; guarded && breaker.Held() {
				continue
			}
			lastSuccess := repository.LastSuccess()
			if lastSuccess.IsZero() || now.Sub(lastSuccess) > 10*time.Minute {
				healthy = false
			}
		}
		for name, repository := range appContext.repositories {
			lastSuccess := repository.LastSuccess()
			status := map[string]any{
				"loaded":       repository.Loaded(),
				"last_success": repository.LastSuccess(),
			}
			if breaker, guarded := appContext.breakers[name]; guarded {
				if held := breaker.Status(); held != nil {
					status["breaker"] = held
					repStatuses[name] = status
					continue
				}
			}
			if lastSuccess.IsZero() || now.Sub(lastSuccess) > 10*time.Minute {
				status["error"] = fmt.Sprintf("no refreshes since: %s", lastSuccess)
			}
			repStatuses[name] = status
		}
		if healthy {
			c.JSON(http.StatusOK, gin.H{
				"status":       "pass",
				"repositories": repStatuses,
			})
		} else {
			c.JSON(http.StatusServiceUnavailable, gin.H{
				"status":       "fail",
				"repositories": repStatuses,
			})
		}
	})

	return router
}
func (r *Router) RepositoryHandler(c *gin.Context) {
	repName := c.Param("repository")
	repository, ok := r.appContext.repositories[repName]
	if !ok {
		r.Infof("Repository %s not found, initializing", repName)
		// lazily created repositories get breaker protection too when their
		// name is in BREAKER_REPOSITORIES; they are not registered in
		// appContext.breakers (populated at startup only — mutating it here
		// would race concurrent handlers), so /health and the accept endpoint
		// don't cover them: env-level BREAKER_* switches are the override path
		var data appbase.RepositoryData[[]byte] = &RawRepositoryData{validateJSON: true}
		if r.appContext.config.BreakerEnabled {
			for _, guarded := range strings.Split(r.appContext.config.BreakerRepositories, ",") {
				if strings.TrimSpace(guarded) == repName {
					data = NewBreakerRepositoryData(repName, BreakerConfig{
						MaxChangePercent: r.appContext.config.BreakerMaxChangePercent,
						MinChangedRows:   r.appContext.config.BreakerMinChangedRows,
					}, r.appContext.config.CacheDir)
					break
				}
			}
		}
		repository = appbase.NewHTTPRepository[[]byte](repName, r.appContext.config.RepositoryBaseURL+"/"+repName, r.appContext.config.RepositoryAuthToken, appbase.HTTPTagLastModified, data, 2, r.appContext.config.RepositoryRefreshPeriodSec, r.appContext.config.CacheDir)
		initTimeout := time.After(time.Second * 60)
		ticker := time.NewTicker(time.Second)
		defer ticker.Stop()
		select {
		case <-ticker.C:
			if repository.Loaded() {
				r.Infof("Repository %s initialized", repName)
				r.appContext.repositories[repName] = repository
				break
			}
		case <-initTimeout:
			if !repository.Loaded() {
				_ = repository.Close()
				r.Errorf("Repository %s initialization timeout", repName)
				_ = c.AbortWithError(http.StatusInternalServerError, fmt.Errorf("Repository %s initialization timeout", repName))
				return
			} else {
				r.Infof("Repository %s initialized", repName)
				r.appContext.repositories[repName] = repository
				break
			}
		}
	}
	var ifModifiedSince time.Time
	var err error
	ifModifiedSinceS := c.GetHeader("If-Modified-Since")
	if ifModifiedSinceS != "" {
		ifModifiedSince, err = time.Parse(http.TimeFormat, ifModifiedSinceS)
		if err != nil {
			fmt.Println("Error parsing If-Modified-Since header:", err)
		}
	}
	lastModified := repository.GetLastModified()

	if !ifModifiedSince.IsZero() && !lastModified.IsZero() && !lastModified.After(ifModifiedSince) {
		c.Header("Last-Modified", lastModified.Format(http.TimeFormat))
		c.Status(http.StatusNotModified)
		return
	}
	if !lastModified.IsZero() {
		c.Header("Last-Modified", lastModified.Format(http.TimeFormat))
	}
	c.Writer.Header().Set("Content-Type", "application/json")
	_, _ = c.Writer.Write(*repository.GetData())
}

func (r *Router) ScriptHandler(c *gin.Context) {
	ifNoneMatch := c.GetHeader("If-None-Match")
	etag := r.appContext.pScript.GetEtag()

	if ifNoneMatch != "" && ifNoneMatch == etag {
		c.Header("ETag", etag)
		c.Status(http.StatusNotModified)
		return
	}
	if etag != "" {
		c.Header("ETag", etag)
	}
	c.Writer.Header().Set("Content-Type", "application/javascript")
	_, _ = c.Writer.Write(*r.appContext.pScript.GetData())
}
