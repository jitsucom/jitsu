package middleware

import (
	"context"

	"github.com/gin-gonic/gin"
	"github.com/jitsucom/jitsu/configurator/common"
	"github.com/jitsucom/jitsu/configurator/entities"
	"github.com/jitsucom/jitsu/configurator/openapi"
	"github.com/jitsucom/jitsu/server/logging"
	"github.com/pkg/errors"
)

var (
	errUnauthorized        = errors.New("unauthorized")
	errServerTokenMismatch = errors.New("server token mismatch")
	errTokenMismatch       = errors.New("token mismatch")
)

const (
	authorityKey = "__authority"
)

type Authorization struct {
	User    openapi.UserBasicInfo
	IsAdmin bool
}

type Authority struct {
	Token      string
	IsAdmin    bool
	ProjectIDs common.StringSet
	user       *openapi.UserBasicInfo
}

func (a *Authority) Allow(projectID string) bool {
	return a.IsAdmin || a.ProjectIDs[projectID]
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
		invalidToken(ctx, errTokenMismatch)
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

	authority.ProjectIDs = make(common.StringSet)

	if managementScope {
		if user := authority.user; user != nil {
			if projectIDs, err := i.Configurations.GetUserProjects(user.Id); err != nil {
				logging.Warnf("failed to get projects for user %s: %s", user.Id, err)
			} else {
				authority.ProjectIDs.AddAll(projectIDs...)
			}
		}

		if i.IsSelfHosted {
			authority.ProjectIDs.Add(entities.TelemetryGlobalID)
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
