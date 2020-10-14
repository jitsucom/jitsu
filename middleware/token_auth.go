package middleware

import (
	"github.com/gin-gonic/gin"
	"github.com/ksensehq/eventnative/logging"
	"net"
	"net/http"
	"net/url"
	"strings"
)

const TokenName = "token"

//TokenAuth check that provided token equals
func TokenAuth(main gin.HandlerFunc, originalToken string) gin.HandlerFunc {
	return func(c *gin.Context) {
		queryValues := c.Request.URL.Query()
		token := queryValues.Get(TokenName)

		if token == originalToken {
			main(c)
		} else {
			c.Writer.WriteHeader(http.StatusUnauthorized)
			c.Writer.Write([]byte("Wrong token"))
		}
	}
}

//TokenOriginsAuth check that provided token:
//1. is valid
//2. exists in specific (js or api) token config
//3. origins equal
func TokenOriginsAuth(main gin.HandlerFunc, isAllowedOriginsFunc func(string) ([]string, bool), errMsg string) gin.HandlerFunc {
	return func(c *gin.Context) {
		queryValues := c.Request.URL.Query()
		token := queryValues.Get(TokenName)

		if token == "" {
			token = c.Request.Header.Get("x-auth-token")
		}

		origins, allowed := isAllowedOriginsFunc(token)
		if !allowed {
			c.Writer.WriteHeader(http.StatusUnauthorized)
			if errMsg != "" {
				c.Writer.Write([]byte(errMsg))
			}
			return
		}

		if len(origins) > 0 {
			reqOrigin := c.GetHeader("Origin")
			if reqOrigin == "" {
				c.AbortWithStatus(http.StatusUnauthorized)
				return
			}

			u, err := url.Parse(reqOrigin)
			if err != nil {
				logging.Errorf("Error parsing origin [%s]: %v", reqOrigin, err)
				c.AbortWithStatus(http.StatusUnauthorized)
				return
			}

			originDomain := u.Host
			if strings.Contains(u.Host, ":") {
				host, _, err := net.SplitHostPort(u.Host)
				if err != nil {
					logging.Errorf("Error extracting domain from [%s]: %v", u.Host, err)
					c.AbortWithStatus(http.StatusUnauthorized)
					return
				}
				originDomain = host
			}

			allowedOriginExists := false
			for _, allowedOrigin := range origins {
				if checkOrigin(allowedOrigin, originDomain) {
					allowedOriginExists = true
					break
				}
			}

			if !allowedOriginExists {
				c.AbortWithStatus(http.StatusUnauthorized)
				return
			}
		}

		c.Set(TokenName, token)

		main(c)
	}
}

func checkOrigin(allowedOrigin, origin string) bool {
	var prefix, suffix bool
	if strings.HasPrefix(allowedOrigin, "*") {
		allowedOrigin = strings.Replace(allowedOrigin, "*", "", 1)
		prefix = true
	}

	if strings.HasSuffix(allowedOrigin, "*") {
		allowedOrigin = strings.Replace(allowedOrigin, "*", "", 1)
		suffix = true
	}

	if prefix && suffix {
		return strings.Contains(origin, allowedOrigin)
	}

	//prefix means '*abc.ru' and we need to check if abc.ru is the suffix of origin
	if prefix {
		return strings.HasSuffix(origin, allowedOrigin)
	}

	//prefix means 'abc*' and we need to check if abc is the prefix of origin
	if suffix {
		return strings.HasPrefix(origin, allowedOrigin)
	}

	return origin == allowedOrigin
}
