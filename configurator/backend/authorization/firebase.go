package authorization

import (
	"cloud.google.com/go/firestore"
	"context"
	"errors"
	"firebase.google.com/go/v4"
	"firebase.google.com/go/v4/auth"
	"fmt"
	"github.com/jitsucom/jitsu/server/logging"
	"google.golang.org/api/option"
	"io"
	"strings"
)

type Provider interface {
	//both authorization types
	io.Closer
	VerifyAccessToken(token string) (string, error)
	IsAdmin(userId string) (bool, error)
	GenerateUserAccessToken(userId string) (string, error)

	UsersExist() (bool, error)
	Type() string

	//only in-house
	GetUserByEmail(email string) (*User, error)
	SaveUser(user *User) error
	CreateTokens(userId string) (*TokenDetails, error)
	DeleteToken(token string) error
	DeleteAllTokens(userId string) error
	SavePasswordResetId(resetId, userId string) error
	DeletePasswordResetId(resetId string) error
	GetUserByResetId(resetId string) (*User, error)
	RefreshTokens(refreshToken string) (*TokenDetails, error)
}

type FirebaseProvider struct {
	ctx             context.Context
	adminDomain     string
	authClient      *auth.Client
	firestoreClient *firestore.Client
}

func NewFirebaseProvider(ctx context.Context, projectId, credentialsFile, adminDomain string) (*FirebaseProvider, error) {
	logging.Infof("Initializing firebase authorization storage..")
	app, err := firebase.NewApp(ctx, &firebase.Config{ProjectID: projectId}, option.WithCredentialsFile(credentialsFile))
	if err != nil {
		return nil, err
	}

	authClient, err := app.Auth(ctx)
	if err != nil {
		return nil, err
	}

	firestoreClient, err := app.Firestore(ctx)
	if err != nil {
		return nil, err
	}

	return &FirebaseProvider{
		ctx:             ctx,
		adminDomain:     adminDomain,
		authClient:      authClient,
		firestoreClient: firestoreClient,
	}, nil
}

func (fp *FirebaseProvider) VerifyAccessToken(token string) (string, error) {
	verifiedToken, err := fp.authClient.VerifyIDToken(fp.ctx, token)
	if err != nil {
		return "", err
	}

	return verifiedToken.UID, nil
}

//IsAdmin return true only if the user is admin and auth type is Google
func (fp *FirebaseProvider) IsAdmin(userId string) (bool, error) {
	authUserInfo, err := fp.authClient.GetUser(fp.ctx, userId)
	if err != nil {
		return false, fmt.Errorf("Failed to get authorization data for user_id [%s]", userId)
	}

	// email domain validation
	email := authUserInfo.Email
	emailSplit := strings.Split(email, "@")
	if len(emailSplit) != 2 {
		return false, fmt.Errorf("Invalid email string %s: should contain exactly one '@' character", email)
	}

	if emailSplit[1] != fp.adminDomain {
		return false, fmt.Errorf("Domain %s is not allowed to use this API", emailSplit[1])
	}

	// authorization method validation
	isGoogleAuth := false
	for _, providerInfo := range authUserInfo.ProviderUserInfo {
		if providerInfo.ProviderID == "google.com" {
			isGoogleAuth = true
			break
		}
	}

	if !isGoogleAuth {
		return false, fmt.Errorf("Only users with Google authorization have access to this API")
	}

	return true, nil
}

func (fp *FirebaseProvider) GenerateUserAccessToken(userId string) (string, error) {
	user, err := fp.authClient.GetUserByEmail(fp.ctx, userId)
	if err != nil {
		return "", err
	}
	return fp.authClient.CustomToken(fp.ctx, user.UID)
}

func (fp *FirebaseProvider) UsersExist() (bool, error) {
	uit := fp.authClient.Users(fp.ctx, "")
	return uit.PageInfo().Remaining() > 0, nil
}

func (fp *FirebaseProvider) Type() string {
	return FirebaseType
}

func (fp *FirebaseProvider) Close() error {
	if err := fp.firestoreClient.Close(); err != nil {
		return fmt.Errorf("Error closing firestore client: %v", err)
	}

	return nil
}

func (fp *FirebaseProvider) GetUserByEmail(email string) (*User, error) {
	errMsg := fmt.Sprintf("GetUserByEmail isn't supported in authorization FirebaseProvider. email: %s", email)
	logging.SystemError(errMsg)
	return nil, errors.New(errMsg)
}

func (fp *FirebaseProvider) SaveUser(user *User) error {
	errMsg := fmt.Sprintf("SaveUser isn't supported in authorization FirebaseProvider. email: %s", user.Email)
	logging.SystemError(errMsg)
	return errors.New(errMsg)
}

func (fp *FirebaseProvider) CreateTokens(userId string) (*TokenDetails, error) {
	errMsg := fmt.Sprintf("CreateTokens isn't supported in authorization FirebaseProvider. userId: %s", userId)
	logging.SystemError(errMsg)
	return nil, errors.New(errMsg)
}

func (fp *FirebaseProvider) DeleteToken(token string) error {
	errMsg := "DeleteToken isn't supported in authorization FirebaseProvider"
	logging.SystemError(errMsg)
	return errors.New(errMsg)
}

func (fp *FirebaseProvider) SavePasswordResetId(resetId, userId string) error {
	errMsg := "SavePasswordResetId isn't supported in authorization FirebaseProvider"
	logging.SystemError(errMsg)
	return errors.New(errMsg)
}

func (fp *FirebaseProvider) DeletePasswordResetId(resetId string) error {
	errMsg := "DeletePasswordResetId isn't supported in authorization FirebaseProvider"
	logging.SystemError(errMsg)
	return errors.New(errMsg)
}

func (fp *FirebaseProvider) GetUserByResetId(resetId string) (*User, error) {
	errMsg := fmt.Sprintf("GetUserByResetId isn't supported in authorization FirebaseProvider. resetId: %s", resetId)
	logging.SystemError(errMsg)
	return nil, errors.New(errMsg)
}

func (fp *FirebaseProvider) DeleteAllTokens(userId string) error {
	errMsg := fmt.Sprintf("DeleteAllTokens isn't supported in authorization FirebaseProvider. userId: %s", userId)
	logging.SystemError(errMsg)
	return errors.New(errMsg)
}

func (fp *FirebaseProvider) RefreshTokens(refreshToken string) (*TokenDetails, error) {
	errMsg := "RefreshTokens isn't supported in authorization FirebaseProvider"
	logging.SystemError(errMsg)
	return nil, errors.New(errMsg)
}
