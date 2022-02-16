package middleware

import (
	"fmt"
	"net/http"
	"regexp"

	"github.com/gin-gonic/gin"
	"github.com/jitsucom/jitsu/configurator/authorization"
	"github.com/jitsucom/jitsu/configurator/common"
	"github.com/jitsucom/jitsu/configurator/openapi"
	"github.com/jitsucom/jitsu/configurator/storages"
	"github.com/jitsucom/jitsu/server/logging"
	"github.com/jitsucom/jitsu/server/middleware"
)

const (
	ProjectIDQuery = "project_id"
	UserIDKey      = "_user_id"
	TokenKey       = "_token"
	Permissions    = "__permissions"

	//DEPRECATED
	ClientAuthHeader = "X-Client-Auth"

	bearerAuthHeader = "authorization"

	//Scopes
	bearerClientScope = "client"
)

var tokenRe = regexp.MustCompile(`(?i)^bearer (.+)$`)

type Authenticator struct {
	serverToken string
	service     *authorization.Service
	selfhosted  bool
}

func NewAuthenticator(serverToken string, service *authorization.Service, selfhosted bool) *Authenticator {
	return &Authenticator{serverToken: serverToken, service: service, selfhosted: selfhosted}
}

//BearerAuth is a middleware for authenticate user with bearer token
func (a *Authenticator) BearerAuth(c *gin.Context) {
	//keys present = authentication required
	_, checkAdminAccess := c.Get(openapi.ClusterAdminAuthScopes)
	_, checkManagementAccess := c.Get(openapi.ConfigurationManagementAuthScopes)
	if !checkAdminAccess && !checkManagementAccess {
		return
	}

	token, ok := getToken(c)
	if !ok {
		return
	}
	c.Set(TokenKey, token)

	access := &ProjectAccess{
		adminAccess: token == a.serverToken,
	}

	if access.adminAccess {
		//add userID if self-hosted (for getting projects/users info)
		if checkManagementAccess {
			userID, err := a.service.GetOnlyUserID()
			//set user id only if exist
			if err != nil {
				logging.Infof("error getting user ID with admin access: %v", err)
			} else {
				c.Set(UserIDKey, userID)
			}
		}

		c.Set(Permissions, access)
		return
	}

	if checkAdminAccess && !access.adminAccess {
		logging.SystemErrorf("Server request [%s] with [%s] token has been denied: token mismatch", c.Request.URL.String(), token)
		c.Writer.Header().Set("WWW-Authenticate", "Bearer realm=\"token_required\" error=\"invalid_token\"")
		c.AbortWithStatusJSON(http.StatusUnauthorized, middleware.ErrResponse("Server Token mismatch", nil))
		return
	}

	if checkManagementAccess {
		userID, err := a.service.Authenticate(c, token)
		if err != nil {
			errAuthenticate(c, token, err)
			return
		}
		c.Set(UserIDKey, userID)

		if projectIDs, err := a.service.GetProjectIDs(userID); err == nil {
			access.projects = common.StringSetFrom(projectIDs)
		}

		//added permissions on global configuration
		if a.selfhosted {
			access.projects[storages.TelemetryGlobalID] = true
		}
	}

	c.Set(Permissions, access)
}

//BearerAuthManagementWrapper is a wrapper for BearerAuth func
//adds minimal openapi.ConfigurationManagementAuthScopes to request
func (a *Authenticator) BearerAuthManagementWrapper(main gin.HandlerFunc) gin.HandlerFunc {
	return func(c *gin.Context) {
		c.Set(openapi.ConfigurationManagementAuthScopes, "")
		a.BearerAuth(c)
		if !c.IsAborted() {
			main(c)
		}
	}

}

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
			c.AbortWithStatusJSON(http.StatusUnauthorized, middleware.ErrResponse("Token is invalid in Header: "+bearerAuthHeader+". Request should contain 'Authorization: Bearer <token>' header.", nil))
			return "", false
		}
	} else {
		//from query, headers (backward compatibility)
		token = ExtractTokenFromDeprecatedParameters(c)
	}

	if token == "" {
		c.Writer.Header().Set("WWW-Authenticate", "Bearer realm=\"token_required\"")
		c.AbortWithStatusJSON(http.StatusUnauthorized, middleware.ErrResponse("Missing Header: "+bearerAuthHeader, nil))
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

//ForbiddenProject returns forbidden project error wrappered into openapi error response
func ForbiddenProject(projectID string) *openapi.ErrorObject {
	eo := &openapi.ErrorObject{
		Message: fmt.Sprintf("User does not have access to the project: %s", projectID),
	}

	return eo
}
