package middleware

import (
	"encoding/json"
	"net/http"
	"strings"

	"github.com/jitsucom/jitsu/server/cors"
)

//Cors handles OPTIONS requests and check if request /event or dynamic event endpoint or static endpoint (/t /s /p)
//if token ok => check origins - if matched write origin to acao header otherwise don't write it
//if not returns 401
func Cors(h http.Handler, isAllowedOriginsFunc func(string) ([]string, bool)) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Add("Access-Control-Allow-Origin", "*")

		if r.Method == "OPTIONS" {
			writeDefaultCorsHeaders(w)
			w.WriteHeader(http.StatusOK)
			return
		}

		if r.URL.Path == "/api/v1/event" || r.URL.Path == "/api/v1/events" || strings.Contains(r.URL.Path, "/api.") {
			writeDefaultCorsHeaders(w)

			token := extractToken(r)
			origins, ok := isAllowedOriginsFunc(token)
			if ok {
				reqOrigin := r.Header.Get("Origin")
				if len(origins) > 0 {
					for _, allowedOrigin := range origins {
						if cors.NewPrefixSuffixRule(allowedOrigin).IsAllowed("", reqOrigin) {
							w.Header().Add("Access-Control-Allow-Origin", reqOrigin)
							break
						}
					}
				} else {
					w.Header().Add("Access-Control-Allow-Origin", reqOrigin)
				}
			} else {
				//Unauthorized
				response := ErrResponse(ErrTokenNotFound, nil)
				b, _ := json.Marshal(response)
				w.WriteHeader(http.StatusUnauthorized)
				w.Write(b)
				return
			}

		} else if strings.Contains(r.URL.Path, "/p/") || strings.Contains(r.URL.Path, "/s/") || strings.Contains(r.URL.Path, "/t/") {
			writeDefaultCorsHeaders(w)
			w.Header().Add("Access-Control-Allow-Origin", "*")
		}

		h.ServeHTTP(w, r)
	})
}

func writeDefaultCorsHeaders(w http.ResponseWriter) {
	w.Header().Add("Access-Control-Max-Age", "86400")
	w.Header().Add("Access-Control-Allow-Methods", "POST, GET, OPTIONS, PUT, DELETE, UPDATE, PATCH")
	w.Header().Add("Access-Control-Allow-Headers", "Content-Type, Content-Length, Accept-Encoding, X-CSRF-Token, Authorization, Host")
	w.Header().Add("Access-Control-Allow-Credentials", "true")
}
