package authorization

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"github.com/go-playground/validator/v10"
	"github.com/jitsucom/jitsu/configurator/storages"
	"github.com/jitsucom/jitsu/server/logging"
	"github.com/jitsucom/jitsu/server/meta"
	uuid "github.com/satori/go.uuid"
	"github.com/spf13/viper"
	"golang.org/x/crypto/bcrypt"
	"os"
	"time"
)

const (
	UsersInfoCollection = "users_info"
	usersInfoEmailKey   = "_email"
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

type SSOToken struct {
	AccessToken  string `json:"access_token" redis:"access_token"`
	RefreshToken string `json:"refresh_token" redis:"refresh_token"`
	UserID       string `json:"user_id,omitempty" redis:"user_id"`
	Provider     string `json:"provider,omitempty" redis:"provider"`
}

type SSOConfig struct {
	Provider       string        `json:"provider" validate:"required"`
	Tenant         string        `json:"tenant" validate:"required"`
	Product        string        `json:"product" validate:"required"`
	TokenUrl       string        `json:"token_url" validate:"required"`
	ProfileUrl     string        `json:"profile_url" validate:"required"`
	AuthUrl        string        `json:"auth_url" validate:"required"`
	AccessTokenTTL time.Duration `json:"access_token_ttl" validate:"required"`
}

type Service struct {
	authProvider          Provider
	ssoAuthProvider       SSOProvider
	configurationsStorage storages.ConfigurationsStorage
}

func NewService(ctx context.Context, vp *viper.Viper, storage storages.ConfigurationsStorage) (*Service, error) {
	var authProvider Provider
	var ssoAuthProvider SSOProvider
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

		ssoAuthProvider = CreateSSOProvider(vp)
	} else {
		return nil, errors.New("Unknown 'auth' section type. Supported: firebase, redis")
	}

	return &Service{authProvider: authProvider, ssoAuthProvider: ssoAuthProvider, configurationsStorage: storage}, nil
}

func CreateSSOProvider(vp *viper.Viper) SSOProvider {
	var ssoProvider SSOProvider
	var err error

	ssoConfig := &SSOConfig{}
	envConfig := os.Getenv("SSO_CONFIG")

	if envConfig == "" {
		vpSSO := vp.Sub("sso")
		if vpSSO == nil {
			logging.Info("No SSO config provided, skipping initialize SSO Auth")
			return nil
		}

		ssoConfig = &SSOConfig{
			Provider:       vpSSO.GetString("provider"),
			Tenant:         vpSSO.GetString("tenant"),
			Product:        vpSSO.GetString("product"),
			TokenUrl:       vpSSO.GetString("tokenUrl"),
			ProfileUrl:     vpSSO.GetString("profileUrl"),
			AuthUrl:        vpSSO.GetString("authUrl"),
			AccessTokenTTL: vpSSO.GetDuration("accessTokenTTL"),
		}
	} else {
		err = json.Unmarshal([]byte(envConfig), ssoConfig)
		if err != nil {
			logging.Errorf("Can't unmarshal SSO_CONFIG from env variables: %v", err)
			return nil
		}
	}

	validate := validator.New()
	err = validate.Struct(ssoConfig)
	if err != nil {
		logging.Errorf("Missed required SSO config params: %v", err)
		return nil
	}

	if ssoConfig.Provider == "boxyhq" {
		ssoProvider, err = NewBoxyHQProvider(ssoConfig)
		if err != nil {
			logging.Error(err)
			return nil
		}
		return ssoProvider
	} else {
		logging.Errorf("Provider %s not supported", ssoConfig.Provider)
		return nil
	}
}

//Authenticate verify access token and return user id
func (s *Service) Authenticate(token string) (string, error) {
	userID, err := s.authProvider.VerifyAccessToken(token)
	if err != nil {
		return "", err
	}

	return userID, nil
}

//GetProjectID return projectID from storage by userID
func (s *Service) GetProjectID(userID string) (string, error) {
	usersInfoResponse, err := s.configurationsStorage.Get(UsersInfoCollection, userID)
	if err != nil {
		return "", err
	}

	var userInfo UserInfo
	err = json.Unmarshal(usersInfoResponse, &userInfo)
	if err != nil {
		return "", err
	}

	if userInfo.Project.ID == "" {
		return "", fmt.Errorf("_project._id is not set for user %s", userID)
	}

	return userInfo.Project.ID, nil
}

//GetUserProjects return projects array by userID
func (s *Service) GetUserProjects(userID string) ([]Project, error) {
	usersInfoResponse, err := s.configurationsStorage.Get(UsersInfoCollection, userID)
	if err != nil {
		return nil, err
	}

	userInfo := UserInfo{}
	err = json.Unmarshal(usersInfoResponse, &userInfo)
	if err != nil {
		return nil, err
	}

	return []Project{userInfo.Project}, nil
}

//GetOnlyUserID return the only userID. Works only in self-hosted (when authorization is via Redis)
func (s *Service) GetOnlyUserID() (string, error) {
	return s.authProvider.GetOnlyUserID()
}

//GenerateUserToken generate access token for userID
func (s *Service) GenerateUserToken(userID string) (string, error) {
	return s.authProvider.GenerateUserAccessToken(userID)
}

//IsAdmin return true if the user id admin
func (s *Service) IsAdmin(userID string) (bool, error) {
	return s.authProvider.IsAdmin(userID)
}

//SignUp check existence of the email and create a new User
//return TokenDetails with JWT access token and refresh token
func (s *Service) SignUp(email, password string) (*TokenDetails, error) {
	_, err := s.authProvider.GetUserByEmail(email)
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
	err = s.authProvider.SaveUser(&User{
		ID:             userID,
		Email:          email,
		HashedPassword: hashedPassword,
	})
	if err != nil {
		return nil, err
	}

	return s.authProvider.CreateTokens(userID)
}

//SignIn check email and password and return TokenDetails with JWT access token and refresh token
func (s *Service) SignIn(email, password string) (*TokenDetails, error) {
	user, err := s.authProvider.GetUserByEmail(email)
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
func (s *Service) CreateResetID(email string) (string, string, error) {
	user, err := s.authProvider.GetUserByEmail(email)
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
func (s *Service) ChangePassword(resetID *string, clientAuthToken, newPassword string) (*TokenDetails, error) {
	var user *User
	var err error
	if resetID != nil {
		user, err = s.authProvider.GetUserByResetID(*resetID)
		if err != nil {
			return nil, err
		}
	} else {
		userID, err := s.Authenticate(clientAuthToken)
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

	err = s.authProvider.SaveUser(user)
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

func (s *Service) GetUserByEmail(email string) (*User, error) {
	return s.authProvider.GetUserByEmail(email)
}

func (s *Service) GetAuthorizationType() string {
	return s.authProvider.Type()
}

func (s *Service) SSOAuthenticate(code string) (*TokenDetails, error) {
	if s.authProvider.Type() != RedisType {
		msg := fmt.Sprintf("SSO Auth is not supported for %s auth provider", s.authProvider.Type())
		return nil, errors.New(msg)
	}

	if s.ssoAuthProvider == nil {
		return nil, errors.New("SSO Auth is not configured")
	}

	ssoUser, err := s.ssoAuthProvider.GetUser(code)
	if err != nil {
		return nil, err
	}

	user, err := s.GetUserByEmail(ssoUser.Email)
	if err != nil {
		return nil, err
	}

	td, err := s.authProvider.CreateTokens(user.ID)
	if err != nil {
		return nil, err
	}

	ssoToken := SSOToken{
		AccessToken: ssoUser.AccessToken,
		UserID:      ssoUser.ID,
		Provider:    s.ssoAuthProvider.Name(),
	}

	err = s.authProvider.SaveSSOUserToken(user.ID, &ssoToken)
	if err != nil {
		return nil, err
	}

	return td, nil
}

func (s *Service) GetSSOAuthorizationLink() string {
	if s.ssoAuthProvider == nil {
		return ""
	}
	return s.ssoAuthProvider.AuthLink()
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
