package middleware

import (
	"context"

	"github.com/gin-gonic/gin"
	"github.com/jitsucom/jitsu/configurator/common"
	"github.com/jitsucom/jitsu/configurator/openapi"
	"github.com/jitsucom/jitsu/configurator/storages"
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

type AuthorizationInterceptor struct {
	ServerToken    string
	Authorizator   Authorizator
	Configurations *storages.ConfigurationsService
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
		if userInfo, err := i.Configurations.UpdateUserInfo(user.Id, UserInfoEmailUpdate{Email: user.Email}); err != nil {
			logging.Errorf("failed to update user info for id [%s] with email [%s]: %s", user.Id, user.Email, err)
		} else {
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
			authority.ProjectIDs.Add(storages.TelemetryGlobalID)
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

func GetAuthority(ctx *gin.Context) (*Authority, error) {
	if value, ok := ctx.Get(authorityKey); !ok {
		return nil, errUnauthorized
	} else if authority, ok := value.(*Authority); !ok {
		return nil, errors.Errorf("unexpected authority %+v", authority)
	} else {
		return authority, nil
	}
}

type UserInfoEmailUpdate struct {
	Email string `json:"_email"`
}
