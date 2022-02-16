package authorization

import (
	"context"
	"encoding/json"
	"fmt"

	"github.com/pkg/errors"

	"github.com/jitsucom/jitsu/configurator/storages"
	"github.com/jitsucom/jitsu/server/logging"
	"github.com/jitsucom/jitsu/server/meta"
	uuid "github.com/satori/go.uuid"
	"github.com/spf13/viper"
	"golang.org/x/crypto/bcrypt"
)

const (
	UsersInfoCollection = "users_info"
	usersInfoEmailKey   = "_email"
	userProjectRelation = "user_project"
	RedisType           = "redis"
	FirebaseType        = "firebase"
)

var (
	ErrUserNotFound      = errors.New("User wasn't found")
	ErrUserExists        = errors.New("User already exists")
	ErrResetIDNotFound   = errors.New("Reset id wasn't found")
	ErrIncorrectPassword = errors.New("Incorrect password")
	ErrExpiredToken      = errors.New("Expired token")
	ErrUnknownToken      = errors.New("Unknown token")
)

type Service struct {
	authProvider Provider

	configurationsStorage storages.ConfigurationsStorage
}

func NewService(ctx context.Context, vp *viper.Viper, storage storages.ConfigurationsStorage) (*Service, error) {
	var authProvider Provider
	var err error
	if vp.IsSet("auth.firebase.project_id") {
		authProvider, err = NewFirebaseProvider(ctx, vp.GetString("auth.firebase.project_id"), vp.GetString("auth.firebase.credentials_file"), vp.GetString("auth.admin_domain"), vp.GetStringSlice("auth.admin_users"))
		if err != nil {
			return nil, err
		}
	} else if vp.IsSet("auth.redis.host") {
		host := vp.GetString("auth.redis.host")
		if host == "" {
			return nil, errors.New("auth.redis.host is required")
		}

		port := vp.GetInt("auth.redis.port")
		sentinelMaster := vp.GetString("auth.redis.sentinel_master_name")
		redisPassword := vp.GetString("auth.redis.password")
		tlsSkipVerify := vp.GetBool("auth.redis.tls_skip_verify")

		redisPoolFactory := meta.NewRedisPoolFactory(host, port, redisPassword, tlsSkipVerify, sentinelMaster)
		if defaultPort, ok := redisPoolFactory.CheckAndSetDefaultPort(); ok {
			logging.Infof("auth.redis.port isn't configured. Will be used default: %d", defaultPort)
		}

		authProvider, err = NewRedisProvider(redisPoolFactory)
		if err != nil {
			return nil, err
		}
	} else {
		return nil, errors.New("Unknown 'auth' section type. Supported: firebase, redis")
	}

	return &Service{authProvider: authProvider, configurationsStorage: storage}, nil
}

//Authenticate verify access token and return user id
func (s *Service) Authenticate(ctx context.Context, token string) (string, error) {
	userID, err := s.authProvider.VerifyAccessToken(ctx, token)
	if err != nil {
		return "", err
	}

	return userID, nil
}

// GetProjectIDs returns linked project IDs for the user.
func (s *Service) GetProjectIDs(userID string) ([]string, error) {
	return s.configurationsStorage.GetRelatedIDs(userProjectRelation, userID)
}

//GetOnlyUserID return the only userID. Works only in self-hosted (when authorization is via Redis)
func (s *Service) GetOnlyUserID() (string, error) {
	return s.authProvider.GetOnlyUserID()
}

//GenerateUserToken generate access token for userID
func (s *Service) GenerateUserToken(ctx context.Context, userID string) (string, error) {
	return s.authProvider.GenerateUserAccessToken(ctx, userID)
}

//IsAdmin return true if the user id admin
func (s *Service) IsAdmin(ctx context.Context, userID string) (bool, error) {
	return s.authProvider.IsAdmin(ctx, userID)
}

//SignUp check existence of the email and create a new User
//return TokenDetails with JWT access token and refresh token
func (s *Service) SignUp(ctx context.Context, email, password string) (*TokenDetails, error) {
	_, err := s.authProvider.GetUserByEmail(ctx, email)
	if err == nil {
		return nil, ErrUserExists
	}

	if err != ErrUserNotFound {
		return nil, err
	}

	hashedPassword, err := s.hashAndSalt(password)
	if err != nil {
		return nil, err
	}

	userID := "user-" + uuid.NewV4().String()
	err = s.authProvider.SaveUser(ctx, &User{
		ID:             userID,
		Email:          email,
		HashedPassword: hashedPassword,
	})
	if err != nil {
		return nil, err
	}

	return s.authProvider.CreateTokens(userID)
}

func (s *Service) GetUserByEmail(ctx context.Context, email string) (*User, error) {
	return s.authProvider.GetUserByEmail(ctx, email)
}

//SignIn check email and password and return TokenDetails with JWT access token and refresh token
func (s *Service) SignIn(ctx context.Context, email, password string) (*TokenDetails, error) {
	user, err := s.authProvider.GetUserByEmail(ctx, email)
	if err != nil {
		return nil, err
	}

	err = s.comparePasswords(user.HashedPassword, password)
	if err != nil {
		return nil, ErrIncorrectPassword
	}

	return s.authProvider.CreateTokens(user.ID)
}

//SignOut delete token from authorization storage
func (s *Service) SignOut(token string) error {
	return s.authProvider.DeleteAccessToken(token)
}

//CreateResetID return rest id and email
func (s *Service) CreateResetID(ctx context.Context, email string) (string, string, error) {
	user, err := s.authProvider.GetUserByEmail(ctx, email)
	if err != nil {
		return "", "", err
	}

	resetID := "reset-" + uuid.NewV4().String()

	err = s.authProvider.SavePasswordResetID(resetID, user.ID)
	if err != nil {
		return "", "", err
	}

	return resetID, user.Email, nil
}

//ChangeEmail proxies request to auth provider
func (s *Service) ChangeEmail(oldEmail, newEmail string) error {
	userID, err := s.authProvider.ChangeUserEmail(oldEmail, newEmail)
	if err != nil {
		return err
	}

	usersInfoBytes, err := s.configurationsStorage.Get(UsersInfoCollection, userID)
	if err != nil {
		return err
	}

	usersInfo := map[string]interface{}{}
	if err := json.Unmarshal(usersInfoBytes, &usersInfo); err != nil {
		return fmt.Errorf("failed to deserialize users info: %v", err)
	}

	usersInfo[usersInfoEmailKey] = newEmail
	b, err := json.Marshal(usersInfo)
	if err != nil {
		return fmt.Errorf("failed to serialize users info: %v", err)
	}

	return s.configurationsStorage.Store(UsersInfoCollection, userID, b)
}

//ChangePassword gets user by reset ID or by authorization token
//changes user password and delete all tokens
func (s *Service) ChangePassword(ctx context.Context, resetID *string, clientAuthToken, newPassword string) (*TokenDetails, error) {
	var user *User
	var err error
	if resetID != nil {
		user, err = s.authProvider.GetUserByResetID(*resetID)
		if err != nil {
			return nil, err
		}
	} else {
		userID, err := s.Authenticate(ctx, clientAuthToken)
		if err != nil {
			return nil, err
		}

		user, err = s.authProvider.GetUserByID(userID)
		if err != nil {
			return nil, err
		}
	}

	hashedPassword, err := s.hashAndSalt(newPassword)
	if err != nil {
		return nil, err
	}
	user.HashedPassword = hashedPassword

	err = s.authProvider.DeleteAllTokens(user.ID)
	if err != nil {
		return nil, err
	}

	err = s.authProvider.SaveUser(ctx, user)
	if err != nil {
		return nil, err
	}

	if resetID != nil {
		err = s.authProvider.DeletePasswordResetID(*resetID)
		if err != nil {
			return nil, err
		}
	}

	return s.authProvider.CreateTokens(user.ID)
}

func (s *Service) Refresh(refreshToken string) (*TokenDetails, error) {
	return s.authProvider.RefreshTokens(refreshToken)
}

func (s *Service) UsersExist() (bool, error) {
	return s.authProvider.UsersExist()
}

func (s *Service) GetAuthorizationType() string {
	return s.authProvider.Type()
}

func (s *Service) Close() error {
	if err := s.authProvider.Close(); err != nil {
		return fmt.Errorf("Error closing authorization provider: %v", err)
	}

	return nil
}

func (s *Service) hashAndSalt(password string) (string, error) {
	hash, err := bcrypt.GenerateFromPassword([]byte(password), bcrypt.MinCost)
	if err != nil {
		return "", err
	}

	return string(hash), nil
}

func (s *Service) comparePasswords(hashedPassword string, password string) error {
	err := bcrypt.CompareHashAndPassword([]byte(hashedPassword), []byte(password))
	if err != nil {
		return err
	}

	return nil
}
