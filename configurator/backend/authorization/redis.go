package authorization

import (
	"encoding/json"
	"errors"
	"fmt"
	"github.com/gomodule/redigo/redis"
	"github.com/jitsucom/jitsu/server/logging"
	"github.com/jitsucom/jitsu/server/meta"
	"github.com/jitsucom/jitsu/server/timestamp"
)

const (
	//DEPRECATED
	accessTokensPrefix = "jwt_access_tokens"
	//DEPRECATED
	refreshTokensPrefix = "jwt_refresh_tokens"

	authAccessTokensKey  = "auth_access_tokens"
	authRefreshTokensKey = "auth_refresh_tokens"
)

//** redis key [variables] - description **
//user#userID [email, salt.passwordhash] -
//users_index [email, id, email, id] hashtable where field = email and value = id
//password_reset#reset_id user_id 1 hour - key contains user_id with ttl = 1 hour

//auth_access_tokens [access_token] hashtable with JSON string value = {user_id, expired_at, paired_token}
//auth_refresh_tokens [refresh_token] hashtable with JSON string value = {user_id, expired_at, paired_token}

//DEPRECATED
//jwt_access_tokens:user#userID [access_token_id, refresh_token_id, access_token_id, refresh_token_id] hashtable where field = access_token_id and value = refresh_token_id (TTL RefreshTokenTTL)
//jwt_refresh_tokens:user#userID [refresh_token_id, access_token_id, refresh_token_id, access_token_id] hashtable where field = refresh_token_id and value = access_token_id (TTL RefreshTokenTTL)

//RedisProvider provides authorization storage
type RedisProvider struct {
	tokenManager *TokenManager
	pool         *meta.RedisPool
}

func NewRedisProvider(factory *meta.RedisPoolFactory) (*RedisProvider, error) {
	logging.Infof("Initializing redis authorization storage [%s]...", factory.Details())

	pool, err := factory.Create()
	if err != nil {
		return nil, err
	}

	return &RedisProvider{
		tokenManager: &TokenManager{},
		pool:         pool,
	}, nil
}

//VerifyAccessToken verifies token
//returns user id if token is valid
func (rp *RedisProvider) VerifyAccessToken(accessToken string) (string, error) {
	tokenEntity, err := rp.getTokenData(accessToken, authAccessTokensKey)
	if err != nil {
		return "", err
	}

	expiredAt, err := timestamp.ParseISOFormat(tokenEntity.ExpiredAt)
	if err != nil {
		return "", err
	}

	if timestamp.Now().After(expiredAt) {
		return "", ErrExpiredToken
	}

	return tokenEntity.UserID, nil
}

func (rp *RedisProvider) UsersExist() (bool, error) {
	conn := rp.pool.Get()
	defer conn.Close()

	exists, err := redis.Bool(conn.Do("EXISTS", "users_index"))
	if err != nil && err != redis.ErrNil {
		return false, err
	}

	return exists, nil
}

//GetUserByID returns User by user ID
func (rp *RedisProvider) GetUserByID(userID string) (*User, error) {
	conn := rp.pool.Get()
	defer conn.Close()

	userValues, err := redis.Values(conn.Do("HGETALL", "user#"+userID))
	if err != nil {
		if err == redis.ErrNil {
			return nil, ErrUserNotFound
		}

		return nil, err
	}

	user := &User{}
	err = redis.ScanStruct(userValues, user)
	if err != nil {
		return nil, fmt.Errorf("Error deserializing user entity [%s]: %v", userID, err)
	}

	return user, nil
}

//GetUserByEmail returns User by email
func (rp *RedisProvider) GetUserByEmail(email string) (*User, error) {
	conn := rp.pool.Get()
	defer conn.Close()

	//get userID from index
	userID, err := redis.String(conn.Do("HGET", "users_index", email))
	if err != nil {
		if err == redis.ErrNil {
			return nil, ErrUserNotFound
		}

		return nil, err
	}

	userValues, err := redis.Values(conn.Do("HGETALL", "user#"+userID))
	if err != nil {
		if err == redis.ErrNil {
			logging.SystemErrorf("User with id: %s exists in users_index but doesn't exist in user#%s record", userID, userID)
			return nil, ErrUserNotFound
		}

		return nil, err
	}

	user := &User{}
	err = redis.ScanStruct(userValues, user)
	if err != nil {
		return nil, fmt.Errorf("Error deserializing user entity [%s]: %v", userID, err)
	}

	return user, nil
}

//SaveUser save user in Redis and update users index
func (rp *RedisProvider) SaveUser(user *User) error {
	conn := rp.pool.Get()
	defer conn.Close()

	//save user
	_, err := conn.Do("HSET", "user#"+user.ID, "id", user.ID, "email", user.Email, "hashed_password", user.HashedPassword)
	if err != nil && err != redis.ErrNil {
		return err
	}

	//update index
	_, err = conn.Do("HSET", "users_index", user.Email, user.ID)
	if err != nil && err != redis.ErrNil {
		return err
	}

	return nil
}

//DeleteAllTokens removes both access and refresh tokens from Redis by userIDs
func (rp *RedisProvider) DeleteAllTokens(userID string) error {
	conn := rp.pool.Get()
	defer conn.Close()

	if err := rp.deleteAllUsersTokens(userID, authAccessTokensKey); err != nil {
		return fmt.Errorf("error deleting access tokens: %v", err)
	}

	if err := rp.deleteAllUsersTokens(userID, authRefreshTokensKey); err != nil {
		return fmt.Errorf("error deleting refresh tokens: %v", err)
	}

	return nil
}

//deleteAllUsersTokens iterates through token types and if token belongs to user - delete it
func (rp *RedisProvider) deleteAllUsersTokens(userID, redisTokenKey string) error {
	conn := rp.pool.Get()
	defer conn.Close()

	tokenEntitiesStrs, err := redis.Strings(conn.Do("HGETALL", redisTokenKey))
	if err != nil && err != redis.ErrNil {
		return err
	}

	for _, tokenEntityStr := range tokenEntitiesStrs {
		tokenEntity := &TokenEntity{}
		if err := json.Unmarshal([]byte(tokenEntityStr), tokenEntity); err != nil {
			logging.Infof("error unmarshal token entity [%v] for [%s] userID: %v", tokenEntityStr, userID, err)
			return err
		}

		if tokenEntity.UserID == userID {
			if err := rp.deleteToken(tokenEntity); err != nil {
				logging.Infof("error deleting token %v: %v", tokenEntity, err)
				return err
			}
		}
	}

	return nil
}

func (rp *RedisProvider) CreateTokens(userID string) (*TokenDetails, error) {
	accessTokenEntity := rp.tokenManager.CreateAccessToken(userID)
	refreshTokenEntity := rp.tokenManager.CreateRefreshToken(userID)

	//link access token to refresh token
	accessTokenEntity.RefreshToken = refreshTokenEntity.RefreshToken
	refreshTokenEntity.AccessToken = accessTokenEntity.AccessToken

	if err := rp.saveToken(authAccessTokensKey, accessTokenEntity.AccessToken, accessTokenEntity); err != nil {
		return nil, fmt.Errorf("error saving %s: %v", authAccessTokensKey, err)
	}

	if err := rp.saveToken(authRefreshTokensKey, accessTokenEntity.RefreshToken, refreshTokenEntity); err != nil {
		return nil, fmt.Errorf("error saving %s: %v", refreshTokenEntity, err)
	}

	return &TokenDetails{
		AccessTokenEntity:  accessTokenEntity,
		RefreshTokenEntity: refreshTokenEntity,
	}, nil
}

func (rp *RedisProvider) RefreshTokens(refreshToken string) (*TokenDetails, error) {
	tokenEntity, err := rp.getTokenData(refreshToken, authRefreshTokensKey)
	if err != nil {
		return nil, err
	}

	expiredAt, err := timestamp.ParseISOFormat(tokenEntity.ExpiredAt)
	if err != nil {
		return nil, err
	}

	if timestamp.Now().After(expiredAt) {
		if err := rp.deleteToken(tokenEntity); err != nil {
			logging.Errorf("error deleting expired token %s: %v", refreshToken, err)
		}

		return nil, ErrExpiredToken
	}

	//delete tokens
	err = rp.deleteToken(tokenEntity)
	if err != nil {
		return nil, err
	}

	return rp.CreateTokens(tokenEntity.UserID)
}

//SavePasswordResetID save reset id with ttl 1 hour
func (rp *RedisProvider) SavePasswordResetID(resetID, userID string) error {
	conn := rp.pool.Get()
	defer conn.Close()

	_, err := conn.Do("SET", "password_reset#"+resetID, userID, "EX", 3600)
	if err != nil && err != redis.ErrNil {
		return err
	}

	return nil
}

//DeletePasswordResetID delete reset id
func (rp *RedisProvider) DeletePasswordResetID(resetID string) error {
	conn := rp.pool.Get()
	defer conn.Close()

	_, err := conn.Do("DEL", "password_reset#"+resetID)
	if err != nil && err != redis.ErrNil {
		return err
	}

	return nil
}

//GetUserByResetID return user from Redis
func (rp *RedisProvider) GetUserByResetID(resetID string) (*User, error) {
	conn := rp.pool.Get()
	defer conn.Close()

	//get userID
	userID, err := redis.String(conn.Do("GET", "password_reset#"+resetID))
	if err != nil {
		if err == redis.ErrNil {
			return nil, ErrResetIDNotFound
		}

		return nil, err
	}

	//get user
	userValues, err := redis.Values(conn.Do("HGETALL", "user#"+userID))
	if err != nil {
		if err == redis.ErrNil {
			logging.SystemErrorf("User with id: %s exists in reset password record [%s] but doesn't exist in user#%s record", userID, resetID, userID)
			return nil, err
		}

		return nil, err
	}

	user := &User{}
	err = redis.ScanStruct(userValues, user)
	if err != nil {
		return nil, fmt.Errorf("Error deserializing user entity [%s]: %v", userID, err)
	}

	return user, nil
}

//saveToken saves JSON token entity under redis KEY into hashtable
func (rp *RedisProvider) saveToken(tokenRedisKey, token string, tokenEntity *TokenEntity) error {
	conn := rp.pool.Get()
	defer conn.Close()

	b, _ := json.Marshal(tokenEntity)
	_, err := conn.Do("HSET", tokenRedisKey, token, b)
	if err != nil && err != redis.ErrNil {
		return err
	}

	return nil
}

func (rp *RedisProvider) getTokenData(token, tokenType string) (*TokenEntity, error) {
	conn := rp.pool.Get()
	defer conn.Close()

	tokenDataStr, err := redis.String(conn.Do("HGET", tokenType, token))
	if err != nil {
		if err == redis.ErrNil {
			return nil, ErrUnknownToken
		}

		return nil, err
	}

	if len(tokenDataStr) == 0 {
		return nil, ErrUnknownToken
	}

	tokenEntity := &TokenEntity{}
	if err := json.Unmarshal([]byte(tokenDataStr), tokenEntity); err != nil {
		msg := fmt.Sprintf("malformed token [%s] data [%v]: %v", token, tokenDataStr, err)
		logging.SystemError(msg)
		return nil, errors.New(msg)
	}

	return tokenEntity, nil
}

func (rp *RedisProvider) DeleteAccessToken(token string) error {
	conn := rp.pool.Get()
	defer conn.Close()

	tokenDataStr, err := redis.String(conn.Do("HGET", authAccessTokensKey, token))
	if err != nil && err != redis.ErrNil {
		return err
	}

	if len(tokenDataStr) == 0 {
		return nil
	}

	tokenEntity := &TokenEntity{}
	if err := json.Unmarshal([]byte(tokenDataStr), tokenEntity); err != nil {
		return fmt.Errorf("malformed token [%s] data: %v", token, tokenDataStr)
	}

	return rp.deleteToken(tokenEntity)
}

//deleteToken removes access and refresh (access and refresh) tokens from Redis
func (rp *RedisProvider) deleteToken(tokenEntity *TokenEntity) error {
	conn := rp.pool.Get()
	defer conn.Close()

	_, err := conn.Do("HDEL", authAccessTokensKey, tokenEntity.AccessToken)
	if err != nil && err != redis.ErrNil {
		return err
	}

	_, err = conn.Do("HDEL", authRefreshTokensKey, tokenEntity.RefreshToken)
	if err != nil && err != redis.ErrNil {
		return err
	}

	return nil
}

func (rp *RedisProvider) Type() string {
	return RedisType
}

func (rp *RedisProvider) Close() error {
	return rp.pool.Close()
}

//IsAdmin isn't supported as Google Authorization isn't supported
func (rp *RedisProvider) IsAdmin(userID string) (bool, error) {
	logging.SystemErrorf("IsAdmin isn't supported in authorization RedisProvider. userID: %s", userID)
	return false, nil
}

func (rp *RedisProvider) GenerateUserAccessToken(userID string) (string, error) {
	errMsg := fmt.Sprintf("GenerateUserToken isn't supported in authorization RedisProvider. userID: %s", userID)
	logging.SystemError(errMsg)
	return "", errors.New(errMsg)
}
