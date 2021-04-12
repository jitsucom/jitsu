package jitsu

import (
	"github.com/gin-gonic/gin"
	"io"
)

type Request struct {
	Method string
	URN    string
	Body   io.Reader
}

type APIDecorator func(c *gin.Context) *Request
