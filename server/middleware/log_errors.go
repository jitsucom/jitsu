package middleware

import (
	"bytes"
	"github.com/gin-gonic/gin"
	"github.com/jitsucom/jitsu/server/logging"
)

type GinErrorBodyWriter struct {
	gin.ResponseWriter
	body *bytes.Buffer
}

func (gebw *GinErrorBodyWriter) Write(b []byte) (int, error) {
	gebw.body.Write(b)
	return gebw.ResponseWriter.Write(b)
}

func GinLogErrorBody(c *gin.Context) {
	blw := &GinErrorBodyWriter{body: bytes.NewBufferString(""), ResponseWriter: c.Writer}
	c.Writer = blw
	c.Next()
	statusCode := c.Writer.Status()
	if statusCode >= 400 {
		//log error body response
		logging.Errorf("[response] %q error: %s", c.Request.URL.String(), blw.body.String())
	}
}
