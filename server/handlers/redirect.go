package handlers

import (
	"github.com/gin-gonic/gin"
	"net/http"
)

//Handle redirects
type RedirectHandler struct {
	toURL string
}

func NewRedirectHandler(redirectToURL string) *RedirectHandler {
	return &RedirectHandler{toURL: redirectToURL}
}

func (rh *RedirectHandler) Handler(c *gin.Context) {
	c.Redirect(http.StatusPermanentRedirect, rh.toURL)
}
