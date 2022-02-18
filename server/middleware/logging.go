package middleware

import (
	"bytes"
	"io"
	"io/ioutil"
	"net/http"

	"github.com/gin-gonic/gin"
	"github.com/jitsucom/jitsu/server/logging"
)

type bufferingLogWriter struct {
	gin.ResponseWriter
	body *bytes.Buffer
}

func (w bufferingLogWriter) Write(b []byte) (int, error) {
	w.body.Write(b)
	return w.ResponseWriter.Write(b)
}

func ErrorLogWriter(ctx *gin.Context) {
	writer := &bufferingLogWriter{
		body:           bytes.NewBufferString(""),
		ResponseWriter: ctx.Writer,
	}

	body := []byte("")
	if ctx.Request.Body != nil && ctx.Request.ContentLength > 0 && ctx.Request.ContentLength < 1000 {
		var err error
		body, err = io.ReadAll(ctx.Request.Body)
		_ = ctx.Request.Body.Close()
		if err != nil {
			logging.Warnf("Failed to buffer HTTP request body for %s %s with content length %d",
				ctx.Request.Method, ctx.Request.URL.String(), ctx.Request.ContentLength)
			ctx.AbortWithStatusJSON(http.StatusBadRequest, ErrResponse("failed to read request body", err))
			return
		}

		ctx.Request.Body = ioutil.NopCloser(bytes.NewReader(body))
	}

	ctx.Writer = writer
	ctx.Next()

	statusCode := writer.Status()
	if statusCode >= 400 {
		logging.Errorf("Handle HTTP %s %s with body '%s' failed with %d '%s'",
			ctx.Request.Method, ctx.Request.URL.String(), body, statusCode, writer.body.String())
	}
}
