package main

import (
	"github.com/gin-gonic/gin"
	"net/http"
	"net/http/httptest"
	"testing"
)

func TestUnhealthyResponseDoesNotExposeDependencies(t *testing.T) {
	w := httptest.NewRecorder()
	c, _ := gin.CreateTestContext(w)
	r := &Router{}
	r.Health(c)
	if w.Code != http.StatusServiceUnavailable || w.Body.String() != `{"status":"fail"}` {
		t.Fatalf("unexpected health response: %d %s", w.Code, w.Body)
	}
}
