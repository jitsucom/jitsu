package middleware

import (
	"github.com/gin-gonic/gin"
	"github.com/jitsucom/jitsu/configurator/authorization"
	"github.com/jitsucom/jitsu/configurator/openapi"
	"github.com/jitsucom/jitsu/server/logging"
	"github.com/jitsucom/jitsu/server/middleware"
	"net/http"
	"regexp"
)

const (
	ProjectIDKey = "_project_id"
	UserIDKey    = "_user_id"
	TokenKey     = "_token"

	//DEPRECATED
	ClientAuthHeader = "X-Client-Auth"

	bearerAuthHeader = "authorization"

	//Scopes
	bearerClientScope        = "client"
	bearerClientProjectScope = "client:project"
	bearerServerScope        = "server"
)

var tokenRe = regexp.MustCompile(`(?i)^bearer (.+)$`)

type Authenticator struct {
	serverToken string
	service     *authorization.Service
}

func NewAuthenticator(serverToken string, service *authorization.Service) *Authenticator {
	return &Authenticator{serverToken: serverToken, service: service}
}

//BearerAuth is a middleware for authenticate user with bearer token
func (a *Authenticator) BearerAuth(c *gin.Context) {
	//scopes present = authentication required
	scopes, ok := c.Get(openapi.BearerAuthScopes)
	if ok {
		token, ok := getToken(c)
		if !ok {
			return
		}
		c.Set(TokenKey, token)

		// ** Check scope **
		scopesStrs := scopes.([]string)
		for _, scope := range scopesStrs {
			switch scope {
			case bearerClientScope:
				userID, err := a.service.Authenticate(token)
				if err != nil {
					errAuthenticate(c, token, err)
					return
				}
				c.Set(UserIDKey, userID)
			case bearerClientProjectScope:
				userID, err := a.service.Authenticate(token)
				if err != nil {
					errAuthenticate(c, token, err)
					return
				}

				projectID, err := a.service.GetProjectID(userID)
				if err != nil {
					errProjectID(c, token, err)
					return
				}

				c.Set(ProjectIDKey, projectID)
				c.Set(UserIDKey, userID)
			case bearerServerScope:
				if token != a.serverToken {
					logging.SystemErrorf("Server request [%s] with [%s] token has been denied: token mismatch", c.Request.URL.String(), token)
					c.Writer.Header().Set("WWW-Authenticate", "Bearer realm=\"token_required\" error=\"invalid_token\"")
					c.AbortWithStatusJSON(http.StatusUnauthorized, middleware.ErrResponse("Server Token mismatch", nil))
					return
				}
			default:
				logging.SystemErrorf("%s unknown bearer authorization scope: %v", c.Request.URL, scope)
				c.Writer.Header().Set("WWW-Authenticate", "Bearer realm=\"insufficient_scope\" error=\"insufficient_scope\"")
				c.AbortWithStatusJSON(http.StatusForbidden, middleware.ErrResponse("Insufficient scope", nil))
				return
			}
		}
	}
}

//OldStyleBearerAuth is a middleware for authenticate user with bearer token for backward compatibility
//TODO delete this func after moving all API endpoints to openAPI
func (a *Authenticator) OldStyleBearerAuth(main gin.HandlerFunc, extractProjectID bool) gin.HandlerFunc {
	return func(c *gin.Context) {
		token, ok := getToken(c)
		if !ok {
			return
		}
		c.Set(TokenKey, token)

		userID, err := a.service.Authenticate(token)
		if err != nil {
			errAuthenticate(c, token, err)
			return
		}
		c.Set(UserIDKey, userID)

		if extractProjectID {
			projectID, err := a.service.GetProjectID(userID)
			if err != nil {
				errProjectID(c, token, err)
				return
			}

			c.Set(ProjectIDKey, projectID)
		}

		main(c)
	}
}

//getToken extracts token from all supported headers/query parameters
//returns false if error/true if success
func getToken(c *gin.Context) (string, bool) {
	var token string

	//from bearer
	authHeader := c.GetHeader(bearerAuthHeader)
	if len(authHeader) != 0 {
		matches := tokenRe.FindAllStringSubmatch(authHeader, -1)
		if len(matches) == 0 || len(matches[0]) == 0 {
			c.Writer.Header().Set("WWW-Authenticate", "Bearer realm=\"invalid_token\" error=\"invalid_token\"")
			c.AbortWithStatusJSON(http.StatusUnauthorized, middleware.ErrResponse("Token is invalid in Header: "+bearerAuthHeader+". Request should contain 'Authorization: Bearer <token>' header.", nil))
			return "", false
		}

		token = matches[0][1]
	} else {
		//from query, headers (backward compatibility)
		token = extractTokenFromDeprecatedParameters(c)
	}

	if token == "" {
		c.Writer.Header().Set("WWW-Authenticate", "Bearer realm=\"token_required\"")
		c.AbortWithStatusJSON(http.StatusUnauthorized, middleware.ErrResponse("Missing Header: "+bearerAuthHeader, nil))
		return "", false
	}

	return token, true
}

func extractTokenFromDeprecatedParameters(c *gin.Context) string {
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

func errAuthenticate(c *gin.Context, token string, err error) {
	logging.Errorf("Failed to authenticate with token %s: %v", token, err)
	c.Writer.Header().Set("WWW-Authenticate", "Bearer realm=\"token_required\" error=\"invalid_token\"")
	c.AbortWithStatusJSON(http.StatusUnauthorized, middleware.ErrResponse("Token mismatch", nil))
}

func errProjectID(c *gin.Context, token string, err error) {
	logging.SystemErrorf("Project id error in token %s: %v", token, err)
	c.Writer.Header().Set("WWW-Authenticate", "Bearer realm=\"token_required\" error=\"not_allowed\"")
	c.AbortWithStatusJSON(http.StatusForbidden, middleware.ErrResponse("Forbidden", err))
}
