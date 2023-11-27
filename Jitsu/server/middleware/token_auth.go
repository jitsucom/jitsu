package middleware

import (
	"fmt"
	"github.com/gin-gonic/gin"
	"net/http"
	"strings"
)

const (
	TokenName        = "token"
	APIKeyName       = "api_key"
	TokenHeaderName  = "x-auth-token"
	ErrTokenNotFound = "The token is not found: %s"

	JitsuAnonymIDCookie   = "__eventn_id"
	CookiePolicyParameter = "cookie_policy"
	IPPolicyParameter     = "ip_policy"

	KeepValue   = "keep"
	StrictValue = "strict"
	ComplyValue = "comply"
)

//extractToken return token from
//1. query parameter
//2. header
//3. dynamic query parameter
//4. basic auth username
func extractToken(r *http.Request) string {
	queryValues := r.URL.Query()
	token := queryValues.Get(TokenName)

	if token == "" {
		token = r.Header.Get(TokenHeaderName)
	}

	if token == "" {
		token = r.Header.Get(APIKeyName)
	}

	if token == "" {
		for k, v := range r.URL.Query() {
			if strings.HasPrefix(k, "p_") && len(v) > 0 {
				token = v[0]
				break
			}
		}
	}

	if token == "" {
		token, _, _ = r.BasicAuth()
	}

	return token
}

//TokenAuth check that provided token equals
func TokenAuth(main gin.HandlerFunc, originalToken string) gin.HandlerFunc {
	return func(c *gin.Context) {
		token := extractToken(c.Request)

		if token == originalToken {
			main(c)
		} else {
			c.JSON(http.StatusUnauthorized, ErrResponse("Wrong token", nil))
		}
	}
}

//TokenFuncAuth check that provided token:
//1. is valid
//2. exists in specific (js or api) token config
func TokenFuncAuth(main gin.HandlerFunc, isAllowedOriginsFunc func(string) ([]string, bool), errMsg string) gin.HandlerFunc {
	return func(c *gin.Context) {

		token := extractToken(c.Request)
		if errMsg == "" {
			errMsg = fmt.Sprintf(ErrTokenNotFound, token)
		}
		_, allowed := isAllowedOriginsFunc(token)
		if !allowed {
			c.JSON(http.StatusUnauthorized, ErrResponse(errMsg, nil))
			return
		}

		c.Set(TokenName, token)

		main(c)
	}
}

//TokenTwoFuncAuth check that provided token:
//1. is valid
//2. exists in specific (js or api) token config if not return err msg depend on existing in another token config
func TokenTwoFuncAuth(main gin.HandlerFunc, isAllowedOriginsFunc func(string) ([]string, bool), anotherTypeAllowedOriginsFunc func(string) ([]string, bool), errMsg string) gin.HandlerFunc {
	return func(c *gin.Context) {
		token := extractToken(c.Request)

		_, allowed := isAllowedOriginsFunc(token)
		if !allowed {
			_, exist := anotherTypeAllowedOriginsFunc(token)
			if exist {
				c.JSON(http.StatusUnauthorized, ErrResponse(errMsg, nil))
			} else {
				c.JSON(http.StatusUnauthorized, ErrResponse(fmt.Sprintf(ErrTokenNotFound, token), nil))
			}
			return
		}

		c.Set(TokenName, token)

		main(c)
	}
}
