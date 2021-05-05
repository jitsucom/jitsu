package middleware

import (
	"encoding/json"
	"net/http"
	"strings"
)

//Cors handle OPTIONS requests and check if request /event or dynamic event endpoint or static endpoint (/t /s /p)
//if token ok => check origins - if matched write origin to acao header otherwise don't write it
//if not return 401
func Cors(h http.Handler, isAllowedOriginsFunc func(string) ([]string, bool)) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path == "/api/v1/event" || strings.Contains(r.URL.Path, "/api.") {
			writeDefaultCorsHeaders(w)

			token := extractToken(r)
			origins, ok := isAllowedOriginsFunc(token)
			if ok {
				reqOrigin := r.Header.Get("Origin")
				if len(origins) > 0 {
					for _, allowedOrigin := range origins {
						if checkOrigin(allowedOrigin, reqOrigin) {
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

		if r.Method == "OPTIONS" {
			w.WriteHeader(http.StatusOK)
			return
		}

		h.ServeHTTP(w, r)
	})
}

func writeDefaultCorsHeaders(w http.ResponseWriter) {
	w.Header().Add("Access-Control-Max-Age", "86400")
	w.Header().Add("Access-Control-Allow-Methods", "POST, GET, OPTIONS, PUT, DELETE, UPDATE")
	w.Header().Add("Access-Control-Allow-Headers", "Content-Type, Content-Length, Accept-Encoding, X-CSRF-Token, Authorization, Host")
	w.Header().Add("Access-Control-Allow-Credentials", "true")
}

func checkOrigin(allowedOrigin, reqOrigin string) bool {
	var prefix, suffix bool
	//reformat req origin
	if strings.HasPrefix(reqOrigin, "http://") {
		reqOrigin = strings.Replace(reqOrigin, "http://", "", 1)
	}
	if strings.HasPrefix(reqOrigin, "https://") {
		reqOrigin = strings.Replace(reqOrigin, "https://", "", 1)
	}

	//check
	if strings.HasPrefix(allowedOrigin, "*") {
		allowedOrigin = strings.Replace(allowedOrigin, "*", "", 1)
		prefix = true
	}

	if strings.HasSuffix(allowedOrigin, "*") {
		allowedOrigin = strings.Replace(allowedOrigin, "*", "", 1)
		suffix = true
	}

	if prefix && suffix {
		return strings.Contains(reqOrigin, allowedOrigin)
	}

	//prefix means '*abc.ru' and we need to check if abc.ru is the suffix of origin
	if prefix {
		return strings.HasSuffix(reqOrigin, allowedOrigin)
	}

	//prefix means 'abc*' and we need to check if abc is the prefix of origin
	if suffix {
		return strings.HasPrefix(reqOrigin, allowedOrigin)
	}

	return reqOrigin == allowedOrigin
}
