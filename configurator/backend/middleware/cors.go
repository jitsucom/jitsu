package middleware

import (
	"net/http"
	"net/url"
	"strings"
)

func Cors(h http.Handler, allowedDomainSuffix string) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		reqOrigin := r.Header.Get("Origin")
		u, err := url.Parse(reqOrigin)
		if err == nil {
			reqOriginWithoutPort := strings.Split(u.Host, ":")[0]
			if strings.HasSuffix(reqOriginWithoutPort, allowedDomainSuffix) {
				w.Header().Add("Access-Control-Allow-Origin", reqOrigin)
			}
		}

		w.Header().Add("Access-Control-Max-Age", "86400")
		w.Header().Add("Access-Control-Allow-Methods", "POST, GET, OPTIONS, PUT, DELETE, UPDATE")
		w.Header().Add("Access-Control-Allow-Headers", "Content-Type, Content-Length, Accept-Encoding, X-CSRF-Token, Authorization, Host, X-Client-Auth")
		w.Header().Add("Access-Control-Allow-Credentials", "true")
		if r.Method == "OPTIONS" {
			w.WriteHeader(http.StatusOK)
			return
		}
		h.ServeHTTP(w, r)
	})
}
