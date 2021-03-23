package middleware

import (
	"github.com/gin-gonic/gin"
	"github.com/jitsucom/jitsu/configurator/storages"
	"github.com/jitsucom/jitsu/server/logging"
	"net/http"
	"time"
)

const (
	lastModifiedHeader    = "Last-Modified"
	ifModifiedSinceHeader = "If-Modified-Since"
)

//IfModifiedSince check if content wasn't modified -> return http 304
func IfModifiedSince(main gin.HandlerFunc, getLastModified func() (*time.Time, error)) gin.HandlerFunc {
	return func(c *gin.Context) {
		lastModified, err := getLastModified()
		if err != nil {
			logging.Warnf("Error getting last modified: %v", err)
		} else {
			c.Writer.Header().Add(lastModifiedHeader, lastModified.Format(storages.LastUpdatedLayout))

			ifModifiedSinceStr := c.GetHeader(ifModifiedSinceHeader)
			if ifModifiedSinceStr != "" {
				if ifModifiedSince, err := time.Parse(storages.LastUpdatedLayout, ifModifiedSinceStr); err != nil {
					logging.Warnf("Error parsing [%s:%s] header with [%s] layout: %v", ifModifiedSinceHeader, ifModifiedSinceStr, storages.LastUpdatedLayout, err)
				} else {
					if !lastModified.After(ifModifiedSince) {
						c.Status(http.StatusNotModified)
						return
					}
				}
			}
		}

		main(c)
	}
}
