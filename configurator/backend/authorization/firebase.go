package authorization

import (
	"context"
	"strings"

	firebase "firebase.google.com/go/v4"
	"firebase.google.com/go/v4/auth"
	"github.com/jitsucom/jitsu/configurator/common"
	"github.com/jitsucom/jitsu/configurator/handlers"
	"github.com/jitsucom/jitsu/configurator/middleware"
	"github.com/jitsucom/jitsu/configurator/openapi"
	"github.com/jitsucom/jitsu/server/logging"
	"github.com/pkg/errors"
	uuid "github.com/satori/go.uuid"
	"google.golang.org/api/option"
)

type FirebaseInit struct {
	AdminDomain     string
	AdminEmails     []string
	ProjectID       string
	CredentialsFile string
	MailSender      MailSender
}

type Firebase struct {
	adminDomain string
	adminEmails common.StringSet
	authClient  *auth.Client
	mailSender  MailSender
}

func NewFirebase(ctx context.Context, init FirebaseInit) (*Firebase, error) {
	logging.Infof("Initializing firebase authorization storage..")
	if app, err := firebase.NewApp(ctx,
		&firebase.Config{ProjectID: init.ProjectID},
		option.WithCredentialsFile(init.CredentialsFile)); err != nil {
		return nil, errors.Wrap(err, "init firebase app")
	} else if authClient, err := app.Auth(ctx); err != nil {
		return nil, errors.Wrap(err, "init firebase auth client")
	} else {
		return &Firebase{
			adminDomain: init.AdminDomain,
			adminEmails: common.StringSetFrom(init.AdminEmails),
			authClient:  authClient,
			mailSender:  init.MailSender,
		}, nil
	}
}

func (fb *Firebase) AuthorizationType() string {
	return "firebase"
}

func (fb *Firebase) Local() (handlers.LocalAuthorizator, error) {
	return nil, handlers.ErrIsCloud
}

func (fb *Firebase) Cloud() (handlers.CloudAuthorizator, error) {
	return fb, nil
}

func (fb *Firebase) Authorize(ctx context.Context, token string) (*middleware.Authority, error) {
	if resp, err := fb.authClient.VerifyIDToken(ctx, token); err != nil {
		return nil, errors.Wrap(err, "verify ID token")
	} else if user, err := fb.authClient.GetUser(ctx, resp.UID); err != nil {
		return nil, errors.Wrap(err, "get user")
	} else {
		var isAdmin bool
		if _, ok := fb.adminEmails[user.Email]; ok {
			isAdmin = true
		} else if email := strings.Split(user.Email, "@"); len(email) != 2 {
			// nope
		} else if domain := email[1]; domain != fb.adminDomain {
			// nope
		} else if !isProvidedByGoogle(user.ProviderUserInfo) {
			// nope
		} else {
			isAdmin = true
		}

		return &middleware.Authority{
			UserInfo: &openapi.UserBasicInfo{
				Id:    user.UID,
				Email: user.Email,
			},
			IsAdmin: isAdmin,
		}, nil
	}
}

func (fb *Firebase) FindAnyUser(_ context.Context) (*openapi.UserBasicInfo, error) {
	return nil, nil
}

func (fb *Firebase) HasUsers(_ context.Context) (bool, error) {
	return true, nil
}

func (fb *Firebase) GetUserEmail(ctx context.Context, userID string) (string, error) {
	if resp, err := fb.authClient.GetUser(ctx, userID); err != nil {
		return "", errors.Wrap(err, "get firebase user")
	} else {
		return resp.Email, nil
	}
}

func (fb *Firebase) AutoSignUp(ctx context.Context, email, _ string) (string, error) {
	req := new(auth.UserToCreate).
		Email(email).
		Password(uuid.NewV4().String())
	if resp, err := fb.authClient.GetUserByEmail(ctx, email); err != nil && !strings.Contains(err.Error(), "no user exists") {
		return "", errors.Wrap(err, "get user by email")
	} else if err == nil {
		return resp.UID, ErrUserExists
	} else if !fb.mailSender.IsConfigured() {
		return "", errMailServiceNotConfigured
	} else if resp, err := fb.authClient.CreateUser(ctx, req); err != nil {
		return "", errors.Wrap(err, "create user")
	} else if link, err := fb.authClient.PasswordResetLink(ctx, email); err != nil {
		return "", errors.Wrap(err, "password reset link")
	} else if err := fb.mailSender.SendAccountCreated(email, link); err != nil {
		return "", errors.Wrap(err, "send reset password")
	} else {
		return resp.UID, nil
	}
}

func (fb *Firebase) SignInAs(ctx context.Context, email string) (*openapi.TokenResponse, error) {
	if resp, err := fb.authClient.GetUserByEmail(ctx, email); err != nil {
		return nil, errors.Wrap(err, "get user by email")
	} else if token, err := fb.authClient.CustomToken(ctx, resp.UID); err != nil {
		return nil, errors.Wrap(err, "custom token")
	} else {
		return &openapi.TokenResponse{Token: token}, nil
	}
}

func isProvidedByGoogle(info []*auth.UserInfo) bool {
	for _, info := range info {
		if info.ProviderID == "google.com" {
			return true
		}
	}

	return false
}
