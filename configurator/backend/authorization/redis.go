package authorization

import (
	"context"
	"encoding/json"
	"fmt"
	"strings"
	"time"

	"github.com/gomodule/redigo/redis"
	"github.com/jitsucom/jitsu/configurator/handlers"
	"github.com/jitsucom/jitsu/configurator/middleware"
	"github.com/jitsucom/jitsu/configurator/openapi"
	"github.com/jitsucom/jitsu/server/logging"
	"github.com/jitsucom/jitsu/server/meta"
	"github.com/jitsucom/jitsu/server/timestamp"
	"github.com/pkg/errors"
	uuid "github.com/satori/go.uuid"
)

var (
	errUnknownToken             = errors.New("unknown token")
	errExpiredToken             = errors.New("expired token")
	errMailServiceNotConfigured = errors.New("SMTP service is not configured")
)

const (
	usersIndexKey           = "users_index"
	userIDField             = "id"
	userEmailField          = "email"
	userHashedPasswordField = "hashed_password"
	resetIDTTLSeconds       = 3600
	ssoTokensKey            = "sso_tokens"
)

type RedisInit struct {
	PoolFactory *meta.RedisPoolFactory
	MailSender  MailSender
}

type Redis struct {
	passwordEncoder PasswordEncoder
	redisPool       *meta.RedisPool
	mailSender      MailSender
}

func NewRedis(init RedisInit) (*Redis, error) {
	redisPool, err := init.PoolFactory.Create()
	if err != nil {
		return nil, errors.Wrap(err, "create redis pool")
	}

	return &Redis{
		passwordEncoder: _bcrypt{},
		redisPool:       redisPool,
		mailSender:      init.MailSender,
	}, nil
}

func (r *Redis) AuthorizationType() string {
	return "redis"
}

func (r *Redis) Local() (handlers.LocalAuthorizator, error) {
	return r, nil
}

func (r *Redis) Cloud() (handlers.CloudAuthorizator, error) {
	return nil, errIsLocal
}

func (r *Redis) Close() error {
	return r.redisPool.Close()
}

func (r *Redis) Authorize(ctx context.Context, accessToken string) (*middleware.Authorization, error) {
	conn, err := r.redisPool.GetContext(ctx)
	if err != nil {
		return nil, err
	}

	defer closeQuietly(conn)

	tokenType := accessTokenType
	token, err := r.getToken(conn, tokenType, accessToken)
	if err != nil {
		return nil, middleware.ReadableError{
			Description: "Failed to load user access token from Redis",
			Cause:       err,
		}
	}

	if err := token.validate(); err != nil {
		if err := r.deleteToken(conn, tokenType, token); err != nil {
			logging.SystemErrorf("revoke expired %s [%s] failed: %s", tokenType.name(), tokenType.get(token), err)
		}

		return nil, middleware.ReadableError{
			Description: "User access token is invalid",
			Cause:       err,
		}
	}

	email, err := r.getUserEmail(conn, token.UserID)
	if err != nil {
		return nil, middleware.ReadableError{
			Description: "Failed to load user email from Redis",
			Cause:       err,
		}
	}

	return &middleware.Authorization{
		User: openapi.UserBasicInfo{
			Id:    token.UserID,
			Email: email,
		},
	}, nil
}

func (r *Redis) FindOnlyUser(ctx context.Context) (*openapi.UserBasicInfo, error) {
	conn, err := r.redisPool.GetContext(ctx)
	if err != nil {
		return nil, err
	}

	defer closeQuietly(conn)

	userIDs, err := redis.StringMap(conn.Do("HGETALL", usersIndexKey))
	switch {
	case errors.Is(err, redis.ErrNil):
		return nil, errUserNotFound
	case err != nil:
		return nil, middleware.ReadableError{
			Description: "Failed to load users from Redis",
			Cause:       err,
		}
	}

	var first *openapi.UserBasicInfo = nil
	for email, userID := range userIDs {
		if first != nil {
			return nil, errMultipleUsers
		} else {
			first = &openapi.UserBasicInfo{
				Id:    userID,
				Email: email,
			}
		}
	}

	if first == nil {
		return nil, errUserNotFound
	}

	return first, nil
}

func (r *Redis) HasUsers(ctx context.Context) (bool, error) {
	_, err := r.FindOnlyUser(ctx)
	switch {
	case errors.Is(err, errUserNotFound):
		return false, nil
	case errors.Is(err, errMultipleUsers):
		return true, nil
	case err != nil:
		return false, err
	default:
		return true, nil
	}
}

func (r *Redis) GetUserEmail(ctx context.Context, userID string) (string, error) {
	conn, err := r.redisPool.GetContext(ctx)
	if err != nil {
		return "", err
	}

	defer closeQuietly(conn)
	email, err := r.getUserEmail(conn, userID)
	if err != nil {
		return "", middleware.ReadableError{
			Description: "Failed to load user email from Redis",
			Cause:       err,
		}
	}

	return email, nil
}

func (r *Redis) GetUserIDByEmail(ctx context.Context, userEmail string) (string, error) {
	conn, err := r.redisPool.GetContext(ctx)
	if err != nil {
		return "", err
	}

	defer closeQuietly(conn)
	email, err := r.getUserIDByEmail(conn, userEmail)
	if err != nil {
		return "", middleware.ReadableError{
			Description: "Failed to load user by email from Redis",
			Cause:       err,
		}
	}

	return email, nil
}

func (r *Redis) RefreshToken(ctx context.Context, refreshToken string) (*openapi.TokensResponse, error) {
	conn, err := r.redisPool.GetContext(ctx)
	if err != nil {
		return nil, err
	}

	defer closeQuietly(conn)

	tokenType := refreshTokenType
	token, err := r.getToken(conn, tokenType, refreshToken)
	if err != nil {
		return nil, middleware.ReadableError{
			Description: "Failed to load user refresh token from Redis",
			Cause:       err,
		}
	}

	if err := token.validate(); err != nil {
		if errors.Is(err, errExpiredToken) {
			if err := r.revokeToken(conn, token); err != nil {
				logging.SystemErrorf("revoke expired %s [%s] failed: %s", tokenType.name(), token, err)
			}
		}

		return nil, middleware.ReadableError{
			Description: "Failed to validate user refresh token",
			Cause:       err,
		}
	}

	if err := r.revokeToken(conn, token); err != nil {
		return nil, middleware.ReadableError{
			Description: "Failed to revoke previous user token",
			Cause:       err,
		}
	}

	tokenPair, err := r.generateTokenPair(conn, token.UserID, defaultTokenPairTTL)
	if err != nil {
		return nil, middleware.ReadableError{
			Description: "Failed to generate new token pair in Redis",
			Cause:       err,
		}
	}

	return tokenPair, nil
}

func (r *Redis) SignOut(ctx context.Context, accessToken string) error {
	conn, err := r.redisPool.GetContext(ctx)
	if err != nil {
		return err
	}

	defer closeQuietly(conn)

	token, err := r.getToken(conn, accessTokenType, accessToken)
	switch {
	case errors.Is(err, errUnknownToken):
		return nil
	case err != nil:
		return middleware.ReadableError{
			Description: "Failed to load user access token from Redis",
			Cause:       err,
		}
	}

	if err := r.revokeToken(conn, token); err != nil {
		return middleware.ReadableError{
			Description: "Failed to revoke user token",
			Cause:       err,
		}
	}

	return nil
}

func (r *Redis) AutoSignUp(ctx context.Context, email string, callback *string) (string, error) {
	conn, err := r.redisPool.GetContext(ctx)
	if err != nil {
		return "", err
	}

	defer closeQuietly(conn)

	precondition := func() error {
		switch {
		case callback == nil || *callback == "":
			return errors.New("callback URL is required")
		case !r.mailSender.IsConfigured():
			return errMailServiceNotConfigured
		default:
			return nil
		}
	}

	userID, err := r.createUser(conn, email, uuid.NewV4().String(), precondition)
	switch {
	case errors.Is(err, ErrUserExists):
		return userID, ErrUserExists
	case err != nil:
		return "", middleware.ReadableError{
			Description: "Failed to create user",
			Cause:       err,
		}
	}

	err = r.sendResetPasswordLink(conn, userID, email, *callback, r.mailSender.SendAccountCreated)
	if err != nil {
		if err := r.DeleteUser(ctx, userID); err != nil {
			logging.SystemErrorf("Failed to rollback Redis user creation for [%s] with ID [%s]: %v", email, userID, err)
		}

		return "", middleware.ReadableError{
			Description: "Failed to send user invitation email due to an error (user won't be added)",
			Cause:       err,
		}
	}

	return userID, nil
}

func (r *Redis) SignIn(ctx context.Context, email, password string) (*openapi.TokensResponse, error) {
	conn, err := r.redisPool.GetContext(ctx)
	if err != nil {
		return nil, err
	}

	defer closeQuietly(conn)

	userID, err := r.getUserIDByEmail(conn, email)
	if err != nil {
		return nil, middleware.ReadableError{
			Description: "Failed to load user ID from Redis",
			Cause:       err,
		}
	}

	hashedPassword, err := redis.String(conn.Do("HGET", userKey(userID), userHashedPasswordField))
	switch {
	case errors.Is(err, redis.ErrNil):
		logging.SystemErrorf("User [%s] exists in [%s], but not under [%s]", userID, usersIndexKey, userKey(userID))
		return nil, errUserNotFound
	case err != nil:
		return nil, middleware.ReadableError{
			Description: "Failed to load user data from Redis",
			Cause:       err,
		}
	}

	if err := r.passwordEncoder.Compare(hashedPassword, password); err != nil {
		return nil, errors.New("invalid password")
	}

	tokenPair, err := r.generateTokenPair(conn, userID, defaultTokenPairTTL)
	if err != nil {
		return nil, middleware.ReadableError{
			Description: "Failed to generate new token pair",
			Cause:       err,
		}
	}

	return tokenPair, nil
}

func (r *Redis) SignInSSO(ctx context.Context, provider string, sso *handlers.SSOSession, ttl time.Duration) (*openapi.TokensResponse, error) {
	conn, err := r.redisPool.GetContext(ctx)
	if err != nil {
		return nil, err
	}

	defer closeQuietly(conn)

	userID, err := r.getUserIDByEmail(conn, sso.Email)
	if err != nil {
		return nil, middleware.ReadableError{
			Description: fmt.Sprintf("User %s cannot be found", sso.Email),
			Cause:       err,
		}
	}

	tokenPair, err := r.generateTokenPair(conn, userID, tokenPairTTL{access: ttl, refresh: time.Second})
	if err != nil {
		return nil, middleware.ReadableError{
			Description: "Failed to generate new token pair",
			Cause:       err,
		}
	}

	if ssoToken, err := json.Marshal(ssoRedisToken{
		Provider:    provider,
		UserID:      sso.UserID,
		AccessToken: sso.AccessToken,
	}); err != nil {
		return nil, errors.Wrap(err, "marshal sso token")
	} else if _, err := conn.Do("HSET", ssoTokensKey, userID, ssoToken); err != nil {
		return nil, errors.Wrap(err, "persist sso token")
	}

	return tokenPair, nil
}

func (r *Redis) SignUp(ctx context.Context, email, password string) (*openapi.TokensResponse, error) {
	conn, err := r.redisPool.GetContext(ctx)
	if err != nil {
		return nil, err
	}

	defer closeQuietly(conn)

	userID, err := r.createUser(conn, email, password, always)
	if err != nil {
		return nil, middleware.ReadableError{
			Description: "Failed to create new user in Redis",
			Cause:       err,
		}
	}

	tokenPair, err := r.generateTokenPair(conn, userID, defaultTokenPairTTL)
	if err != nil {
		return nil, middleware.ReadableError{
			Description: "Failed to generate new token pair",
			Cause:       err,
		}
	}

	return tokenPair, nil
}

func (r *Redis) SendResetPasswordLink(ctx context.Context, email, callback string) error {
	if !r.mailSender.IsConfigured() {
		return errMailServiceNotConfigured
	}

	conn, err := r.redisPool.GetContext(ctx)
	if err != nil {
		return err
	}

	defer closeQuietly(conn)

	userID, err := r.getUserIDByEmail(conn, email)
	if err != nil {
		return middleware.ReadableError{
			Description: "Failed to load user ID by email",
			Cause:       err,
		}
	}

	if err := r.sendResetPasswordLink(conn, userID, email, callback, r.mailSender.SendResetPassword); err != nil {
		return middleware.ReadableError{
			Description: "Failed to send reset password link",
			Cause:       err,
		}
	}

	return nil
}

func (r *Redis) ResetPassword(ctx context.Context, resetID, newPassword string) (*openapi.TokensResponse, error) {
	conn, err := r.redisPool.GetContext(ctx)
	if err != nil {
		return nil, err
	}

	defer closeQuietly(conn)

	resetKey := resetKey(resetID)
	userID, err := redis.String(conn.Do("GET", resetKey))
	switch {
	case errors.Is(err, redis.ErrNil):
		return nil, errors.New("Invalid reset password ID")
	case err != nil:
		return nil, middleware.ReadableError{
			Description: "Failed to load user ID by reset password ID",
			Cause:       err,
		}
	}

	if err := r.changePassword(conn, userID, newPassword); err != nil {
		return nil, middleware.ReadableError{
			Description: "Failed to change user password in Redis",
			Cause:       err,
		}
	}

	if _, err := conn.Do("DEL", resetKey); err != nil {
		return nil, errors.Wrap(err, "delete reset id")
	}

	tokenPair, err := r.generateTokenPair(conn, userID, defaultTokenPairTTL)
	if err != nil {
		return nil, middleware.ReadableError{
			Description: "Failed to generate new token pair",
			Cause:       err,
		}
	}

	return tokenPair, nil
}

func (r *Redis) ChangePassword(ctx context.Context, accessToken, newPassword string) (*openapi.TokensResponse, error) {
	conn, err := r.redisPool.GetContext(ctx)
	if err != nil {
		return nil, err
	}

	defer closeQuietly(conn)

	token, err := r.getToken(conn, accessTokenType, accessToken)
	if err != nil {
		return nil, middleware.ReadableError{
			Description: "Failed to load user access token from Redis",
			Cause:       err,
		}
	}

	if err := r.changePassword(conn, token.UserID, newPassword); err != nil {
		return nil, middleware.ReadableError{
			Description: "Failed to change user password in Redis",
			Cause:       err,
		}
	}

	tokenPair, err := r.generateTokenPair(conn, token.UserID, defaultTokenPairTTL)
	if err != nil {
		return nil, middleware.ReadableError{
			Description: "Failed to generate new token pair",
			Cause:       err,
		}
	}

	return tokenPair, nil
}

func (r *Redis) UpdatePassword(ctx context.Context, userID, newPassword string) error {
	conn, err := r.redisPool.GetContext(ctx)
	if err != nil {
		return err
	}

	defer closeQuietly(conn)
	if err := r.changePassword(conn, userID, newPassword); err != nil {
		return middleware.ReadableError{
			Description: "Failed to change user password in Redis",
			Cause:       err,
		}
	}

	return nil
}

func (r *Redis) ChangeEmail(ctx context.Context, oldEmail, newEmail string) (string, error) {
	conn, err := r.redisPool.GetContext(ctx)
	if err != nil {
		return "", err
	}

	defer closeQuietly(conn)

	userID, err := r.getUserIDByEmail(conn, oldEmail)
	if err != nil {
		return "", middleware.ReadableError{
			Description: "Failed to load user ID by email from Redis",
			Cause:       err,
		}
	}

	_, err = r.getUserIDByEmail(conn, newEmail)
	switch {
	case errors.Is(err, errUserNotFound):
	// is ok
	case err != nil:
		return "", middleware.ReadableError{
			Description: "Unable to check email uniqueness",
			Cause:       err,
		}
	default:
		return "", ErrUserExists
	}

	userKey := userKey(userID)
	if _, err := conn.Do("HSET", userKey, userEmailField, newEmail); err != nil {
		return "", errors.Wrapf(err, "update %s", userEmailField)
	}

	if _, err := conn.Do("HSET", usersIndexKey, newEmail, userID); err != nil {
		return "", errors.Wrapf(err, "update %s", usersIndexKey)
	}

	if _, err := conn.Do("HDEL", usersIndexKey, oldEmail); err != nil {
		return "", errors.Wrapf(err, "remove previous email association from %s", usersIndexKey)
	}

	return userID, nil
}

func (r *Redis) ListUsers(ctx context.Context) ([]openapi.UserBasicInfo, error) {
	conn, err := r.redisPool.GetContext(ctx)
	if err != nil {
		return nil, err
	}

	defer closeQuietly(conn)

	values, err := redis.StringMap(conn.Do("HGETALL", usersIndexKey))
	if err != nil {
		return nil, middleware.ReadableError{
			Description: "Failed to load user email index from Redis",
			Cause:       err,
		}
	}

	result := make([]openapi.UserBasicInfo, 0, len(values))
	for email, userID := range values {
		result = append(result, openapi.UserBasicInfo{
			Id:    userID,
			Email: email,
		})
	}

	return result, nil
}

func (r *Redis) CreateUser(ctx context.Context, email string) (*handlers.CreatedUser, error) {
	conn, err := r.redisPool.GetContext(ctx)
	if err != nil {
		return nil, err
	}

	defer closeQuietly(conn)

	userID, err := r.createUser(conn, email, uuid.NewV4().String(), always)
	if err != nil {
		return nil, middleware.ReadableError{
			Description: "Failed to create new user in Redis",
			Cause:       err,
		}
	}

	resetID, err := r.generateResetID(conn, userID)
	if err != nil {
		return nil, middleware.ReadableError{
			Description: "Failed to generate password reset ID",
			Cause:       err,
		}
	}

	return &handlers.CreatedUser{
		ID:      userID,
		ResetID: resetID,
	}, nil
}

func (r *Redis) DeleteUser(ctx context.Context, userID string) error {
	conn, err := r.redisPool.GetContext(ctx)
	if err != nil {
		return err
	}

	defer closeQuietly(conn)

	email, err := r.getUserEmail(conn, userID)
	if err != nil {
		return middleware.ReadableError{
			Description: "Failed to load user email from Redis",
			Cause:       err,
		}
	}

	if err := r.revokeTokens(conn, userID); err != nil {
		logging.SystemErrorf("Failed to revoke user [%s] tokens: %v", userID, err)
	}

	if _, err := conn.Do("DEL", userKey(userID)); err != nil {
		return errors.Wrap(err, "remove user data")
	}

	if _, err := conn.Do("HDEL", usersIndexKey, email); err != nil {
		return errors.Wrapf(err, "remove %s from %s", email, usersIndexKey)
	}

	return nil
}

func (r *Redis) getUserEmail(conn redis.Conn, userID string) (string, error) {
	email, err := redis.String(conn.Do("HGET", userKey(userID), userEmailField))
	switch {
	case errors.Is(err, redis.ErrNil):
		return "", errUserNotFound
	case err != nil:
		return "", err
	}

	return email, nil
}

func (r *Redis) sendResetPasswordLink(conn redis.Conn, userID, email, callback string, send func(email, link string) error) error {
	resetID, err := r.generateResetID(conn, userID)
	if err != nil {
		return errors.Wrap(err, "generate reset id")
	}

	return send(email, strings.ReplaceAll(callback, "{{token}}", resetID))
}

func (r *Redis) generateResetID(conn redis.Conn, userID string) (string, error) {
	resetID := "reset-" + uuid.NewV4().String()
	if _, err := conn.Do("SET", resetKey(resetID), userID, "EX", resetIDTTLSeconds); err != nil {
		return "", errors.Wrap(err, "persist reset id")
	}

	return resetID, nil
}

func (r *Redis) createUser(conn redis.Conn, email, password string, precondition func() error) (string, error) {
	userID, err := r.getUserIDByEmail(conn, email)
	switch {
	case err == nil:
		return userID, ErrUserExists
	case !errors.Is(err, errUserNotFound):
		return "", errors.Wrap(err, "get user by email")
	}

	if err := precondition(); err != nil {
		return "", err
	}

	hashedPassword, err := r.passwordEncoder.Encode(password)
	if err != nil {
		return "", errors.Wrap(err, "encode password")
	}

	id := "user-" + uuid.NewV4().String()
	if _, err := conn.Do("HSET", userKey(id),
		userIDField, id,
		userEmailField, email,
		userHashedPasswordField, hashedPassword,
	); err != nil {
		return "", errors.Wrap(err, "create user")
	}

	if _, err := conn.Do("HSET", usersIndexKey, email, id); err != nil {
		return "", errors.Wrapf(err, "update %s", usersIndexKey)
	}

	return id, nil
}

func (r *Redis) changePassword(conn redis.Conn, userID, newPassword string) error {
	hashedPassword, err := r.passwordEncoder.Encode(newPassword)
	if err != nil {
		return errors.Wrap(err, "encode password")
	}

	if _, err := conn.Do("HSET", userKey(userID), userHashedPasswordField, hashedPassword); err != nil {
		return errors.Wrap(err, "update password")
	}

	if err := r.revokeTokens(conn, userID); err != nil {
		logging.SystemErrorf("Failed to revoke user [%s] tokens: %v", userID, err)
	}

	return nil
}

func (r *Redis) generateTokenPair(conn redis.Conn, userID string, ttl tokenPairTTL) (*openapi.TokensResponse, error) {
	now := timestamp.Now()
	access := newRedisToken(now, userID, accessTokenType, ttl.access)
	refresh := newRedisToken(now, userID, refreshTokenType, ttl.refresh)

	// link tokens
	access.RefreshToken, refresh.AccessToken = refresh.RefreshToken, access.AccessToken

	if err := r.saveToken(conn, accessTokenType, access); err != nil {
		return nil, errors.Wrapf(err, "save %s", accessTokenType.name())
	}

	if err := r.saveToken(conn, refreshTokenType, refresh); err != nil {
		return nil, errors.Wrapf(err, "save %s", refreshTokenType.name())
	}

	return &openapi.TokensResponse{
		UserId:       userID,
		AccessToken:  access.AccessToken,
		RefreshToken: refresh.RefreshToken,
	}, nil
}

func (r *Redis) getUserIDByEmail(conn redis.Conn, email string) (string, error) {
	userID, err := redis.String(conn.Do("HGET", usersIndexKey, email))
	switch {
	case errors.Is(err, redis.ErrNil):
		return "", errUserNotFound
	case err != nil:
		return "", errors.Wrap(err, "find user by email")
	}

	return userID, nil
}

func (r *Redis) saveToken(conn redis.Conn, tokenType redisTokenType, token *redisToken) error {
	data, err := json.Marshal(token)
	if err != nil {
		return errors.Wrap(err, "marshal token")
	}

	if _, err := conn.Do("HSET", tokenType.key(), tokenType.get(token), data); err != nil {
		return errors.Wrap(err, "persist token")
	}

	return nil
}

func (r *Redis) revokeTokens(conn redis.Conn, userID string) error {
	if err := r.revokeTokenType(conn, userID, accessTokenType); err != nil {
		return errors.Wrap(err, "revoke access tokens")
	}

	if err := r.revokeTokenType(conn, userID, refreshTokenType); err != nil {
		return errors.Wrap(err, "revoke refresh tokens")
	}

	return nil
}

func (r *Redis) revokeTokenType(conn redis.Conn, userID string, tokenType redisTokenType) error {
	data, err := redis.StringMap(conn.Do("HGETALL", tokenType.key()))
	switch {
	case errors.Is(err, redis.ErrNil):
		return nil
	case err != nil:
		return errors.Wrap(err, "get tokens")
	}

	for _, data := range data {
		var token redisToken
		if err := json.Unmarshal([]byte(data), &token); err != nil {
			err = errors.Wrapf(err, "malformed token data [%s] for user [%s]", data, userID)
			logging.Info(err)
			return err
		}

		if token.UserID != userID {
			continue
		}

		if err := r.revokeToken(conn, &token); err != nil {
			err = errors.Wrapf(err, "revoke token [%v]", token)
			logging.Info(err)
			return err
		}
	}

	return nil
}

func (r *Redis) revokeToken(conn redis.Conn, token *redisToken) error {
	if err := r.deleteToken(conn, accessTokenType, token); err != nil {
		return err
	} else if err := r.deleteToken(conn, refreshTokenType, token); err != nil {
		return err
	} else {
		return nil
	}
}

func (r *Redis) deleteToken(conn redis.Conn, tokenType redisTokenType, token *redisToken) error {
	_, err := conn.Do("HDEL", tokenType.key(), tokenType.get(token))
	return err
}

func (r *Redis) getToken(conn redis.Conn, tokenType redisTokenType, token string) (*redisToken, error) {
	data, err := redis.Bytes(conn.Do("HGET", tokenType.key(), token))
	switch {
	case errors.Is(err, redis.ErrNil):
		return nil, errUnknownToken
	case err != nil:
		return nil, errors.Wrap(err, "get token")
	}

	if len(data) == 0 {
		return nil, errUnknownToken
	}

	var result redisToken
	if err := json.Unmarshal(data, &result); err != nil {
		err = errors.Wrapf(err, "malformed token [%s] data [%s]", token, string(data))
		logging.SystemError(err)
		return nil, err
	}

	return &result, nil
}

func userKey(userID string) string {
	return "user#" + userID
}

func resetKey(resetID string) string {
	return "password_reset#" + resetID
}

func always() error {
	return nil
}
