package handlers

import (
	"github.com/gin-gonic/gin"
	"net/http"
)

//Handle redirects
type RedirectHandler struct {
	toUrl string
}

func NewRedirectHandler(redirectToUrl string) *RedirectHandler {
	return &RedirectHandler{toUrl: redirectToUrl}
}

func (rh *RedirectHandler) Handler(c *gin.Context) {
	c.Header("Access-Control-Allow-Origin", "*")
	c.Redirect(http.StatusPermanentRedirect, rh.toUrl)
}
