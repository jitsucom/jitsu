package main

import (
	"fmt"
	"github.com/gin-gonic/gin"
	"github.com/jitsucom/bulker/jitsubase/appbase"
	"github.com/jitsucom/bulker/jitsubase/utils"
	"net/http"
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

	engine.GET("/health", func(c *gin.Context) {
		reps := utils.JoinNonEmptyStrings(",", appContext.config.Repositories, "p.js")
		healthy := true
		repStatuses := map[string]any{}
		now := time.Now()
		// one snapshot for both loops, so the two views cannot disagree
		all := appContext.repositories.snapshot()
		for _, rep := range strings.Split(reps, ",") {
			repository, ok := all[rep]
			if !ok {
				healthy = false
				repStatuses[rep] = map[string]any{"error": "not_found"}
				continue
			}
			if !repository.Loaded() {
				healthy = false
			}
			lastSuccess := repository.LastSuccess()
			if lastSuccess.IsZero() || now.Sub(lastSuccess) > 10*time.Minute {
				healthy = false
			}
		}
		for name, repository := range all {
			lastSuccess := repository.LastSuccess()
			status := map[string]any{
				"loaded":       repository.Loaded(),
				"last_success": repository.LastSuccess(),
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
	repository, ok := r.appContext.repositories.get(repName)
	if !ok {
		r.Infof("Repository %s not found, initializing", repName)
		repository = appbase.NewHTTPRepository[[]byte](repName, r.appContext.config.RepositoryBaseURL+"/"+repName, r.appContext.config.RepositoryAuthToken, appbase.HTTPTagLastModified, &RawRepositoryData{validateJSON: true}, 2, r.appContext.config.RepositoryRefreshPeriodSec, r.appContext.config.CacheDir, appbase.WaitForData)
		initTimeout := time.After(time.Second * 60)
		ticker := time.NewTicker(time.Second)
		defer ticker.Stop()
		// keep polling until it loads or the timeout fires: a single receive on
		// the ticker only proves one second passed, not that the load finished
	wait:
		for !repository.Loaded() {
			select {
			case <-ticker.C:
			case <-initTimeout:
				break wait
			}
		}
		if !repository.Loaded() {
			_ = repository.Close()
			r.Errorf("Repository %s initialization timeout", repName)
			_ = c.AbortWithError(http.StatusInternalServerError, fmt.Errorf("repository %s initialization timeout", repName))
			return
		}
		r.Infof("Repository %s initialized", repName)
		// a concurrent request for the same name may have finished first; keep
		// whichever landed in the map and close the loser
		if existing, stored := r.appContext.repositories.addIfAbsent(repName, repository); !stored {
			_ = repository.Close()
			repository = existing
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
	// Repositories wait for their datasource instead of killing the process, so
	// one can be alive but never loaded - GetData is nil until the first load.
	// Say so rather than dereference it, and let the consumer retry.
	data := repository.GetData()
	if data == nil {
		r.Errorf("Repository %s is not loaded yet", repName)
		c.AbortWithStatusJSON(http.StatusServiceUnavailable, gin.H{"error": fmt.Sprintf("repository %s is not loaded yet", repName)})
		return
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
	_, _ = c.Writer.Write(*data)
}

func (r *Router) ScriptHandler(c *gin.Context) {
	ifNoneMatch := c.GetHeader("If-None-Match")
	etag := r.appContext.pScript.GetEtag()

	if ifNoneMatch != "" && ifNoneMatch == etag {
		c.Header("ETag", etag)
		c.Status(http.StatusNotModified)
		return
	}
	script := r.appContext.pScript.GetData()
	if script == nil {
		r.Errorf("p.js is not loaded yet")
		c.AbortWithStatusJSON(http.StatusServiceUnavailable, gin.H{"error": "p.js is not loaded yet"})
		return
	}
	if etag != "" {
		c.Header("ETag", etag)
	}
	c.Writer.Header().Set("Content-Type", "application/javascript")
	_, _ = c.Writer.Write(*script)
}
