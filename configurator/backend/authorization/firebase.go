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
	IsAdmin(userID string) (bool, error)
	GenerateUserAccessToken(userID string) (string, error)

	UsersExist() (bool, error)
	Type() string

	//only in-house
	GetUserByID(userID string) (*User, error)
	GetUserByEmail(email string) (*User, error)
	SaveUser(user *User) error
	CreateTokens(userID string) (*TokenDetails, error)
	DeleteAccessToken(token string) error
	DeleteAllTokens(userID string) error
	SavePasswordResetID(resetID, userID string) error
	DeletePasswordResetID(resetID string) error
	GetUserByResetID(resetID string) (*User, error)
	RefreshTokens(refreshToken string) (*TokenDetails, error)
}

type FirebaseProvider struct {
	ctx             context.Context
	adminDomain     string
	adminUsers      map[string]bool
	authClient      *auth.Client
	firestoreClient *firestore.Client
}

func NewFirebaseProvider(ctx context.Context, projectID, credentialsFile, adminDomain string, adminUsers []string) (*FirebaseProvider, error) {
	logging.Infof("Initializing firebase authorization storage..")
	app, err := firebase.NewApp(ctx, &firebase.Config{ProjectID: projectID}, option.WithCredentialsFile(credentialsFile))
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

	adminUsersMap := map[string]bool{}
	for _, user := range adminUsers {
		adminUsersMap[user] = true
	}

	return &FirebaseProvider{
		ctx:             ctx,
		adminDomain:     adminDomain,
		adminUsers:      adminUsersMap,
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

//IsAdmin return true only if
// 1. input user is in viper 'auth.admin_users' list
// 2. input user has admin domain in email and auth type is Google
func (fp *FirebaseProvider) IsAdmin(userID string) (bool, error) {
	authUserInfo, err := fp.authClient.GetUser(fp.ctx, userID)
	if err != nil {
		return false, fmt.Errorf("Failed to get authorization data for user_id [%s]", userID)
	}

	//** Check admin_users
	if _, ok := fp.adminUsers[authUserInfo.Email]; ok {
		return true, nil
	}

	//** Check email domain
	emailSplit := strings.Split(authUserInfo.Email, "@")
	if len(emailSplit) != 2 {
		return false, fmt.Errorf("Invalid email string %s: should contain exactly one '@' character", authUserInfo.Email)
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

func (fp *FirebaseProvider) GenerateUserAccessToken(userID string) (string, error) {
	user, err := fp.authClient.GetUserByEmail(fp.ctx, userID)
	if err != nil {
		return "", err
	}
	return fp.authClient.CustomToken(fp.ctx, user.UID)
}

//UsersExist returns always true
func (fp *FirebaseProvider) UsersExist() (bool, error) {
	return true, nil
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

func (fp *FirebaseProvider) GetUserByID(userID string) (*User, error) {
	errMsg := fmt.Sprintf("GetUserByID isn't supported in authorization FirebaseProvider. userID: %s", userID)
	logging.SystemError(errMsg)
	return nil, errors.New(errMsg)
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

func (fp *FirebaseProvider) CreateTokens(userID string) (*TokenDetails, error) {
	errMsg := fmt.Sprintf("CreateTokens isn't supported in authorization FirebaseProvider. userID: %s", userID)
	logging.SystemError(errMsg)
	return nil, errors.New(errMsg)
}

func (fp *FirebaseProvider) DeleteAccessToken(token string) error {
	errMsg := "DeleteAccessToken isn't supported in authorization FirebaseProvider"
	logging.SystemError(errMsg)
	return errors.New(errMsg)
}

func (fp *FirebaseProvider) SavePasswordResetID(resetID, userID string) error {
	errMsg := "SavePasswordResetID isn't supported in authorization FirebaseProvider"
	logging.SystemError(errMsg)
	return errors.New(errMsg)
}

func (fp *FirebaseProvider) DeletePasswordResetID(resetID string) error {
	errMsg := "DeletePasswordResetID isn't supported in authorization FirebaseProvider"
	logging.SystemError(errMsg)
	return errors.New(errMsg)
}

func (fp *FirebaseProvider) GetUserByResetID(resetID string) (*User, error) {
	errMsg := fmt.Sprintf("GetUserByResetID isn't supported in authorization FirebaseProvider. resetID: %s", resetID)
	logging.SystemError(errMsg)
	return nil, errors.New(errMsg)
}

func (fp *FirebaseProvider) DeleteAllTokens(userID string) error {
	errMsg := fmt.Sprintf("DeleteAllTokens isn't supported in authorization FirebaseProvider. userID: %s", userID)
	logging.SystemError(errMsg)
	return errors.New(errMsg)
}

func (fp *FirebaseProvider) RefreshTokens(refreshToken string) (*TokenDetails, error) {
	errMsg := "RefreshTokens isn't supported in authorization FirebaseProvider"
	logging.SystemError(errMsg)
	return nil, errors.New(errMsg)
}
