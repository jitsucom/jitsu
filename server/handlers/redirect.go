package handlers

import (
	"github.com/gin-gonic/gin"
	"net/http"
)

//RedirectHandler handles redirects
//1 handler per 1 URL
type RedirectHandler struct {
	toURL string
}

//NewRedirectHandler returns RedirectHandler instance
func NewRedirectHandler(redirectToURL string) *RedirectHandler {
	return &RedirectHandler{toURL: redirectToURL}
}

//Handler writes HTTP 308 with toURL
func (rh *RedirectHandler) Handler(c *gin.Context) {
	c.Redirect(http.StatusPermanentRedirect, rh.toURL)
}
