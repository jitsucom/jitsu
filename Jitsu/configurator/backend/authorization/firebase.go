package authorization

import (
	"context"
	"path/filepath"
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
	if !filepath.IsAbs(init.CredentialsFile) {
		return nil, errors.New("auth.firebase.credentials_file must be an absolute path")
	}

	logging.Infof("Initializing firebase authorization storage..")

	app, err := firebase.NewApp(ctx,
		&firebase.Config{ProjectID: init.ProjectID},
		option.WithCredentialsFile(init.CredentialsFile))
	if err != nil {
		return nil, errors.Wrap(err, "init firebase app")
	}

	authClient, err := app.Auth(ctx)
	if err != nil {
		return nil, errors.Wrap(err, "init firebase auth client")
	}

	return &Firebase{
		adminDomain: init.AdminDomain,
		adminEmails: common.StringSetFrom(init.AdminEmails),
		authClient:  authClient,
		mailSender:  init.MailSender,
	}, nil
}

func (fb *Firebase) AuthorizationType() string {
	return "firebase"
}

func (fb *Firebase) Local() (handlers.LocalAuthorizator, error) {
	return nil, errIsCloud
}

func (fb *Firebase) Cloud() (handlers.CloudAuthorizator, error) {
	return fb, nil
}

func (fb *Firebase) Authorize(ctx context.Context, accessToken string) (*middleware.Authorization, error) {
	token, err := fb.authClient.VerifyIDToken(ctx, accessToken)
	if err != nil {
		return nil, middleware.ReadableError{
			Description: "Failed to verify user token via Firebase",
			Cause:       err,
		}
	}

	user, err := fb.authClient.GetUser(ctx, token.UID)
	if err != nil {
		return nil, middleware.ReadableError{
			Description: "Failed to get user from Firebase",
			Cause:       err,
		}
	}

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

	return &middleware.Authorization{
		User: openapi.UserBasicInfo{
			Id:    user.UID,
			Email: user.Email,
		},
		IsAdmin: isAdmin,
	}, nil
}

func (fb *Firebase) FindOnlyUser(_ context.Context) (*openapi.UserBasicInfo, error) {
	return nil, nil
}

func (fb *Firebase) HasUsers(_ context.Context) (bool, error) {
	return true, nil
}

func (fb *Firebase) GetUserEmail(ctx context.Context, userID string) (string, error) {
	if resp, err := fb.authClient.GetUser(ctx, userID); err != nil {
		return "", err
	} else {
		return resp.Email, nil
	}
}

func (fb *Firebase) AutoSignUp(ctx context.Context, email string, _ *string) (string, error) {
	user, err := fb.authClient.GetUserByEmail(ctx, email)
	switch {
	case err != nil && !strings.Contains(err.Error(), "no user exists"):
		return "", middleware.ReadableError{
			Description: "Failed to get user from Firebase",
			Cause:       err,
		}
	case err == nil:
		return user.UID, ErrUserExists
	}

	if !fb.mailSender.IsConfigured() {
		return "", errMailServiceNotConfigured
	}

	userToCreate := new(auth.UserToCreate).
		Email(email).
		Password(uuid.NewV4().String())

	createdUser, err := fb.authClient.CreateUser(ctx, userToCreate)
	if err != nil {
		return "", middleware.ReadableError{
			Description: "Failed to create user in Firebase",
			Cause:       err,
		}
	}

	defer func() {
		if err != nil {
			if err := fb.authClient.DeleteUser(ctx, createdUser.UID); err != nil {
				logging.SystemErrorf("Failed to rollback Firebase user creation for email [%s]: %v", email, err)
			}
		}
	}()

	var resetLink string
	resetLink, err = fb.authClient.PasswordResetLink(ctx, email)
	if err != nil {
		return "", middleware.ReadableError{
			Description: "Failed to generate password reset link via Firebase (user won't be added)",
			Cause:       err,
		}
	}

	err = fb.mailSender.SendAccountCreated(email, resetLink)
	if err != nil {
		return "", middleware.ReadableError{
			Description: "Failed to send user invitation email due to an error (user won't be added)",
			Cause:       err,
		}
	}

	return createdUser.UID, nil
}

func isProvidedByGoogle(info []*auth.UserInfo) bool {
	for _, info := range info {
		if info.ProviderID == "google.com" {
			return true
		}
	}

	return false
}
