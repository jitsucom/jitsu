package middleware

import (
	"bytes"
	"context"
	"encoding/json"
	"github.com/gin-gonic/gin"
	"github.com/jitsucom/jitsu/configurator/entities"
	"github.com/jitsucom/jitsu/configurator/openapi"
	"github.com/jitsucom/jitsu/server/logging"
	"github.com/pkg/errors"
	"io/ioutil"
)

var (
	errUnauthorized        = errors.New("unauthorized")
	errServerTokenMismatch = errors.New("server token mismatch")
)

const (
	authorityKey = "__authority"
)

type Authorization struct {
	User    openapi.UserBasicInfo
	IsAdmin bool
}
type ProjectIDBody struct {
	ProjectID string `json:"project_id"`
}

type Authority struct {
	Token    string
	IsAdmin  bool
	Projects map[string]*entities.ProjectPermissions
	user     *openapi.UserBasicInfo
}

func (a *Authority) Allow(projectID string) bool {
	if a.IsAdmin {
		return true
	}
	_, ok := a.Projects[projectID]
	return ok
}

// CheckPermission checks if user has provided permission to access project. Enrich response with corresponding error if don't.
func (a *Authority) CheckPermission(ctx *gin.Context, projectID string, permission openapi.ProjectPermission) bool {
	if a.IsAdmin {
		return true
	}
	permissions, ok := a.Projects[projectID]
	if !ok {
		ForbiddenProject(ctx, projectID)
		return false
	}
	for _, p := range *permissions.Permissions {
		if p == permission {
			return true
		}
	}
	NoPermission(ctx, projectID, permission)
	return false
}

func (a *Authority) User() (*openapi.UserBasicInfo, error) {
	if a.user != nil {
		return a.user, nil
	} else {
		return nil, ErrIsAnonymous
	}
}

type Authorizator interface {
	Authorize(ctx context.Context, token string) (*Authorization, error)
	FindOnlyUser(ctx context.Context) (*openapi.UserBasicInfo, error)
}

type Configurations interface {
	UpdateUserInfo(ctx context.Context, id string, patch interface{}) (*entities.UserInfo, error)
	GetUserProjects(userID string) ([]string, error)
	GetProjectPermissions(userId, projectId string) (*entities.ProjectPermissions, error)
}

type AuthorizationInterceptor struct {
	ServerToken    string
	Authorizator   Authorizator
	Configurations Configurations
	IsSelfHosted   bool
}

func (i *AuthorizationInterceptor) Intercept(ctx *gin.Context) {
	_, clusterAdminScope := ctx.Get(openapi.ClusterAdminAuthScopes)
	_, managementScope := ctx.Get(openapi.ConfigurationManagementAuthScopes)
	if !clusterAdminScope && !managementScope {
		return
	}

	var authority Authority
	if token := GetToken(ctx); ctx.IsAborted() {
		return
	} else if i.ServerToken == token {
		authority = Authority{
			Token:   token,
			IsAdmin: true,
		}

		if !managementScope {
			ctx.Set(authorityKey, authority)
			return
		}

		if user, err := i.Authorizator.FindOnlyUser(ctx); err == nil {
			authority.user = user
		}
	} else if clusterAdminScope {
		logging.SystemErrorf("server request [%s] with [%s] token has been denied: token mismatch", ctx.Request.URL.String(), token)
		invalidToken(ctx, errServerTokenMismatch)
		return
	} else if auth, err := i.Authorizator.Authorize(ctx, token); err != nil {
		logging.Errorf("failed to authenticate with token %s: %s", token, err)
		invalidToken(ctx, err)
		return
	} else {
		authority = Authority{
			Token:   token,
			IsAdmin: auth.IsAdmin,
			user:    &auth.User,
		}
	}

	if user := authority.user; user != nil {
		if userInfo, err := i.Configurations.UpdateUserInfo(ctx, user.Id, UserInfoEmailUpdate{Email: user.Email}); err != nil {
			logging.Errorf("failed to update user info for id [%s] with email [%s]: %s", user.Id, user.Email, err)
		} else if userInfo.PlatformAdmin != nil {
			authority.IsAdmin = *userInfo.PlatformAdmin
		}
	}

	authority.Projects = make(map[string]*entities.ProjectPermissions)

	if managementScope {
		if user := authority.user; user != nil {
			if projectIDs, err := i.Configurations.GetUserProjects(user.Id); err != nil {
				logging.Warnf("failed to get projects for user %s: %s", user.Id, err)
			} else {
				for _, projectID := range projectIDs {
					if permissions, err := i.Configurations.GetProjectPermissions(user.Id, projectID); err != nil {
						logging.Errorf("failed to get permissions for user %s and project %s: %s", user.Id, projectID, err)
					} else {
						authority.Projects[projectID] = permissions
					}
				}
			}
		}

		if i.IsSelfHosted {
			authority.Projects[entities.TelemetryGlobalID] = &entities.DefaultProjectPermissions
		}
	}

	ctx.Set(authorityKey, &authority)
}

func (i *AuthorizationInterceptor) ManagementWrapper(body gin.HandlerFunc) gin.HandlerFunc {
	return func(ctx *gin.Context) {
		ctx.Set(openapi.ConfigurationManagementAuthScopes, "")
		i.Intercept(ctx)
		if !ctx.IsAborted() {
			body(ctx)
		}
	}
}

func GetAuthority(ctx context.Context) (*Authority, error) {
	if value, ok := ctx.Value(authorityKey).(*Authority); !ok {
		return nil, errUnauthorized
	} else {
		return value, nil
	}
}

type UserInfoEmailUpdate struct {
	Email string `json:"_email"`
}

func ExtractProjectID(c *gin.Context) string {
	projectId := c.Query("project_id")
	if projectId != "" {
		return projectId
	}

	//read project_id from body
	contents, _ := ioutil.ReadAll(c.Request.Body)
	reqModel := &ProjectIDBody{}
	err := json.Unmarshal(contents, reqModel)
	if err != nil {
		logging.Errorf("Error reading project_id from unmarshalled request body: %v", err)
		return ""
	}

	c.Request.Body = ioutil.NopCloser(bytes.NewReader(contents))

	return reqModel.ProjectID
}
