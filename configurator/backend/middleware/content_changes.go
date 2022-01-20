package middleware

import (
	"github.com/gin-gonic/gin"
	"github.com/jitsucom/jitsu/configurator/storages"
	"github.com/jitsucom/jitsu/server/logging"
	"net/http"
	"sync"
	"time"
)

const (
	lastModifiedHeader    = "Last-Modified"
	ifModifiedSinceHeader = "If-Modified-Since"
)

type ContentChanges struct {
	mutex                *sync.RWMutex
	getLastModifiedFuncs map[string]func() (*time.Time, error)
}

func NewContentChanges(getLastModifiedFuncs map[string]func() (*time.Time, error)) *ContentChanges {
	return &ContentChanges{mutex: &sync.RWMutex{}, getLastModifiedFuncs: getLastModifiedFuncs}
}

//OldStyleIfModifiedSince checks if request should be processed with if-modified-since logic
//returns http 304 if content hasn't been modified
//TODO delete this func after moving all API endpoints to openAPI
func (cc *ContentChanges) OldStyleIfModifiedSince(main gin.HandlerFunc) gin.HandlerFunc {
	return func(c *gin.Context) {
		cc.mutex.RLock()
		getLastModifiedFunc, ok := cc.getLastModifiedFuncs[c.Request.URL.Path]
		cc.mutex.RUnlock()
		if ok {
			if lastModified, err := getLastModifiedFunc(); err != nil {
				logging.Warnf("Error getting last modified: %v", err)
			} else {
				c.Writer.Header().Add(lastModifiedHeader, lastModified.Format(storages.LastUpdatedLayout))

				ifModifiedSinceStr := c.GetHeader(ifModifiedSinceHeader)
				if ifModifiedSinceStr != "" {
					if ifModifiedSince, err := time.Parse(storages.LastUpdatedLayout, ifModifiedSinceStr); err != nil {
						logging.Warnf("Error parsing [%s:%s] header with [%s] layout: %v", ifModifiedSinceHeader, ifModifiedSinceStr, storages.LastUpdatedLayout, err)
					} else {
						if !lastModified.After(ifModifiedSince) {
							c.AbortWithStatus(http.StatusNotModified)
							return
						}
					}
				}
			}
		}

		main(c)
	}
}

//IfModifiedSince checks if request should be processed with if-modified-since logic
//returns http 304 if content hasn't been modified
func (cc *ContentChanges) IfModifiedSince(c *gin.Context) {
	cc.mutex.RLock()
	getLastModifiedFunc, ok := cc.getLastModifiedFuncs[c.Request.URL.Path]
	cc.mutex.RUnlock()
	if ok {
		if lastModified, err := getLastModifiedFunc(); err != nil {
			logging.Warnf("Error getting last modified: %v", err)
		} else {
			c.Writer.Header().Add(lastModifiedHeader, lastModified.Format(storages.LastUpdatedLayout))

			ifModifiedSinceStr := c.GetHeader(ifModifiedSinceHeader)
			if ifModifiedSinceStr != "" {
				if ifModifiedSince, err := time.Parse(storages.LastUpdatedLayout, ifModifiedSinceStr); err != nil {
					logging.Warnf("Error parsing [%s:%s] header with [%s] layout: %v", ifModifiedSinceHeader, ifModifiedSinceStr, storages.LastUpdatedLayout, err)
				} else {
					if !lastModified.After(ifModifiedSince) {
						c.AbortWithStatus(http.StatusNotModified)
						return
					}
				}
			}
		}
	}
}
