package middleware

import (
	"regexp"

	"github.com/gin-gonic/gin"
	"github.com/pkg/errors"
)

const (
	//DEPRECATED
	ClientAuthHeader = "X-Client-Auth"
	bearerAuthHeader = "authorization"
)

var tokenRe = regexp.MustCompile(`(?i)^bearer (.+)$`)

//getToken extracts token from all supported headers/query parameters
//returns false if error/true if success
func getToken(c *gin.Context) (string, bool) {
	var token string

	//from bearer
	authHeader := c.GetHeader(bearerAuthHeader)
	if len(authHeader) != 0 {
		var ok bool
		token, ok = ExtractBearerToken(c)
		if !ok {
			c.Writer.Header().Set("WWW-Authenticate", "Bearer realm=\"invalid_token\" error=\"invalid_token\"")
			Unauthorized(c, errors.Errorf("Token is invalid in header: %s. Request should contain 'Authorization: Bearer <token>' header.", bearerAuthHeader))
			return "", false
		}
	} else {
		//from query, headers (backward compatibility)
		token = ExtractTokenFromDeprecatedParameters(c)
	}

	if token == "" {
		c.Writer.Header().Set("WWW-Authenticate", "Bearer realm=\"token_required\"")
		Unauthorized(c, errors.Errorf("Missing header: %s", bearerAuthHeader))
		return "", false
	}

	return token, true
}

//ExtractBearerToken returns token value from the bearer Authorization header
func ExtractBearerToken(c *gin.Context) (string, bool) {
	authHeader := c.GetHeader(bearerAuthHeader)
	if len(authHeader) != 0 {
		matches := tokenRe.FindAllStringSubmatch(authHeader, -1)
		if len(matches) > 0 && len(matches[0]) > 1 {
			return matches[0][1], true
		}
	}

	return "", false
}

//ExtractTokenFromDeprecatedParameters returns token value from deprecated query parameters and headers
func ExtractTokenFromDeprecatedParameters(c *gin.Context) string {
	queryValues := c.Request.URL.Query()
	token := queryValues.Get("token")
	if token == "" {
		token = c.GetHeader("X-Admin-Token")
	}

	if token == "" {
		token = c.GetHeader(ClientAuthHeader)
	}

	return token
}
