package handlers

import (
	"context"
	"time"

	"github.com/jitsucom/jitsu/configurator/openapi"
	"github.com/pkg/errors"
)

var (
	ErrUserExists       = errors.New("User already exists")
	errSSLNotConfigured = errors.New("SSL is not configured in Jitsu configuration")
)

type CreatedUser struct {
	ID      string
	ResetID string
}

type SSOSession struct {
	UserID      string
	Email       string
	AccessToken string
}

type Authorizator interface {
	AuthorizationType() string
	GetUserEmail(ctx context.Context, userID string) (string, error)
	HasUsers(ctx context.Context) (bool, error)
	AutoSignUp(ctx context.Context, email string, callback *string) (userID string, err error)
	Local() (LocalAuthorizator, error)
	Cloud() (CloudAuthorizator, error)
}

type LocalAuthorizator interface {
	SignUp(ctx context.Context, email, password string) (*openapi.TokensResponse, error)
	SignIn(ctx context.Context, email, password string) (*openapi.TokensResponse, error)
	SignInSSO(ctx context.Context, provider string, session *SSOSession, ttl time.Duration) (*openapi.TokensResponse, error)
	SignOut(ctx context.Context, accessToken string) error
	RefreshToken(ctx context.Context, refreshToken string) (*openapi.TokensResponse, error)
	SendResetPasswordLink(ctx context.Context, email, callback string) error
	ResetPassword(ctx context.Context, resetID, newPassword string) (*openapi.TokensResponse, error)
	ChangePassword(ctx context.Context, accessToken, newPassword string) (*openapi.TokensResponse, error)
	ChangeEmail(ctx context.Context, oldEmail, newEmail string) (userID string, err error)
	ListUsers(ctx context.Context) ([]openapi.UserBasicInfo, error)
	CreateUser(ctx context.Context, email string) (*CreatedUser, error)
	DeleteUser(ctx context.Context, userID string) error
	UpdatePassword(ctx context.Context, userID, password string) error
	GetUserIDByEmail(ctx context.Context, userEmail string) (string, error)
}

type CloudAuthorizator interface {
	SignInAs(ctx context.Context, email string) (*openapi.TokenResponse, error)
}

type SSOProvider interface {
	Name() string
	AccessTokenTTL() time.Duration
	GetSSOSession(ctx context.Context, code string) (*SSOSession, error)
	AuthLink() string
	IsAutoProvisionEnabled() bool
	IsAutoOnboardingEnabled() bool
}
