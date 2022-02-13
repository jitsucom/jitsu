package middleware

import (
	"net/http"

	"github.com/jitsucom/jitsu/configurator/cors"
)

func Cors(h http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		reqOrigin := r.Header.Get("Origin")

		host := r.URL.Query().Get("deployment_domain")
		if host == "" {
			host = r.Header.Get("X-Forwarded-Host")
		}
		if host == "" {
			host = r.Header.Get("Host")
		}

		if cors.Instance.IsAllowedByRules(host, reqOrigin) {
			w.Header().Add("Access-Control-Allow-Origin", reqOrigin)
		}

		w.Header().Add("Access-Control-Max-Age", "86400")
		w.Header().Add("Access-Control-Allow-Methods", "POST, GET, OPTIONS, PUT, DELETE, UPDATE, PATCH")
		w.Header().Add("Access-Control-Allow-Headers", "Content-Type, Content-Length, Accept-Encoding, X-CSRF-Token, Authorization, Host, X-Client-Auth")
		w.Header().Add("Access-Control-Allow-Credentials", "true")
		if r.Method == "OPTIONS" {
			w.WriteHeader(http.StatusOK)
			return
		}
		h.ServeHTTP(w, r)
	})
}
