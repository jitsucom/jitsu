package main

import (
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/gin-gonic/gin"
	"github.com/jitsucom/bulker/jitsubase/appbase"
)

func TestSecurityHeadersCoverAuthFailuresAndPreflight(t *testing.T) {
	base := appbase.NewRouterBase(appbase.Config{RawAuthTokens: "test-token"}, []string{"/public", "/p.js"}, securityHeaders)
	r := &Router{Router: base}
	engine := base.Engine()
	engine.GET("/private", func(c *gin.Context) { c.Status(http.StatusOK) })
	public := engine.Group("")
	public.Use(r.CorsMiddleware)
	public.OPTIONS("/public", func(c *gin.Context) { t.Error("preflight should stop in CORS middleware") })
	public.GET("/public", func(c *gin.Context) { c.JSON(http.StatusBadRequest, gin.H{"error": "bad request"}) })
	public.GET("/p.js", func(c *gin.Context) { c.Data(http.StatusOK, "application/javascript", []byte("window.jitsu={}")) })
	for _, tc := range []struct {
		method, path string
		status       int
	}{
		{http.MethodGet, "/private", http.StatusUnauthorized},
		{http.MethodOptions, "/public", http.StatusOK},
		{http.MethodGet, "/public", http.StatusBadRequest},
		{http.MethodGet, "/p.js", http.StatusOK},
	} {
		t.Run(tc.method+tc.path, func(t *testing.T) {
			w := httptest.NewRecorder()
			req := httptest.NewRequest(tc.method, tc.path, nil)
			req.Header.Set("Origin", "https://customer.example")
			engine.ServeHTTP(w, req)
			if w.Code != tc.status {
				t.Fatalf("status = %d, want %d", w.Code, tc.status)
			}
			for _, name := range []string{"Content-Security-Policy", "Referrer-Policy", "Permissions-Policy"} {
				if w.Header().Get(name) == "" {
					t.Errorf("missing %s", name)
				}
			}
			if tc.path != "/private" && w.Header().Get("Access-Control-Allow-Origin") != "*" {
				t.Error("public CORS was changed")
			}
			if w.Header().Get("Access-Control-Allow-Credentials") != "" {
				t.Error("credentialed CORS was enabled")
			}
			if tc.path == "/p.js" && w.Body.String() != "window.jitsu={}" {
				t.Error("script body was changed")
			}
		})
	}
}
