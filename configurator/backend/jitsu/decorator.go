package jitsu

import (
	"github.com/gin-gonic/gin"
	"io"
	"strings"
)

type Request struct {
	Method string
	URN    string
	Body   io.Reader
}

type APIDecorator func(c *gin.Context) (*Request, error)

//BuildRequest returns jitsu request from incoming gin.Context
func BuildRequest(c *gin.Context) *Request {
	return BuildRequestWithQueryParams(c, nil)
}

//BuildRequestWithQueryParams returns jitsu request from incoming gin.Context with additional query parameters
func BuildRequestWithQueryParams(c *gin.Context, queryParamsToAdd map[string]string) *Request {
	var queryParameters []string
	//add origin query parameter only if it doesn't exist in queryParamsToAdd
	for k, v := range c.Request.URL.Query() {
		if _, ok := queryParamsToAdd[k]; !ok {
			for _, value := range v {
				queryParameters = append(queryParameters, k+"="+value)
			}
		}
	}

	for k, v := range queryParamsToAdd {
		queryParameters = append(queryParameters, k+"="+v)
	}

	query := strings.Join(queryParameters, "&")

	urn := strings.TrimPrefix(c.Request.URL.Path, "/proxy")
	if query != "" {
		urn += "?" + query
	}

	return &Request{
		Method: c.Request.Method,
		URN:    urn,
		Body:   c.Request.Body,
	}
}
