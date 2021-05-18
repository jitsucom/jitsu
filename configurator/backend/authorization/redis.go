package authorization

import (
	"errors"
	"fmt"
	"github.com/gomodule/redigo/redis"
	"github.com/jitsucom/jitsu/server/logging"
	"github.com/jitsucom/jitsu/server/meta"
	"strings"
)

const (
	accessTokensPrefix  = "jwt_access_tokens"
	refreshTokensPrefix = "jwt_refresh_tokens"
)

//** redis key [variables] - description **
//user#userID [email, salt.passwordhash] -
//users_index [email, id, email, id] hashtable where field = email and value = id
//jwt_access_tokens:user#userID [access_token_id, refresh_token_id, access_token_id, refresh_token_id] hashtable where field = access_token_id and value = refresh_token_id (TTL RefreshTokenTTL)
//jwt_refresh_tokens:user#userID [refresh_token_id, access_token_id, refresh_token_id, access_token_id] hashtable where field = refresh_token_id and value = access_token_id (TTL RefreshTokenTTL)
//password_reset#reset_id user_id 1 hour - key contains user_id with ttl = 1 hour

//RedisProvider provide authorization storage
type RedisProvider struct {
	jwtTokenManager *JwtTokenManager
	pool            *redis.Pool
}

func NewRedisProvider(host, password, accessSecret, refreshSecret string, port int) (*RedisProvider, error) {
	connectionStr := fmt.Sprintf("%s:%d", host, port)
	if strings.HasPrefix(host, "redis://") || strings.HasPrefix(host, "rediss://") {
		connectionStr = host
	}
	logging.Infof("Initializing redis authorization storage [%s]...", connectionStr)

	pool, err := meta.NewRedisPool(host, port, password)
	if err != nil {
		return nil, err
	}

	return &RedisProvider{
		pool:            pool,
		jwtTokenManager: NewTokenManager(accessSecret, refreshSecret),
	}, nil
}

//VerifyAccessToken verifies token
//returns user id if token is valid
func (rp *RedisProvider) VerifyAccessToken(strToken string) (string, error) {
	jwtToken, err := rp.jwtTokenManager.ParseToken(strToken, rp.jwtTokenManager.accessKeyFunc)
	if err != nil {
		if err == ErrExpiredToken {
			return "", err
		}

		return "", fmt.Errorf("Token verification error: %v", err)
	}

	//check if token exists in Redis
	exists, err := rp.tokenExists(jwtToken.UserID, jwtToken.UUID, accessTokensPrefix)
	if err != nil {
		return "", fmt.Errorf("Error checking token in Redis: %v", err)
	}

	if !exists {
		return "", ErrUnknownToken
	}

	return jwtToken.UserID, nil
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

//GetUserIDByEmail return User by email
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

func (rp *RedisProvider) DeleteAllTokens(userID string) error {
	conn := rp.pool.Get()
	defer conn.Close()

	//delete all access
	_, err := conn.Do("DEL", accessTokensPrefix+":user#"+userID)
	if err != nil && err != redis.ErrNil {
		return err
	}

	//delete all refresh
	_, err = conn.Do("DEL", refreshTokensPrefix+":user#"+userID)
	if err != nil && err != redis.ErrNil {
		return err
	}

	return nil
}

func (rp *RedisProvider) DeleteToken(strToken string) error {
	jwtToken, err := rp.jwtTokenManager.ParseToken(strToken, rp.jwtTokenManager.accessKeyFunc)
	if err != nil {
		if err == ErrExpiredToken {
			return err
		}

		return fmt.Errorf("Token verification error: %v", err)
	}

	err = rp.deleteToken(jwtToken.UserID, jwtToken.UUID, accessTokensPrefix, refreshTokensPrefix)
	if err != nil {
		return err
	}

	return nil
}

func (rp *RedisProvider) CreateTokens(userID string) (*TokenDetails, error) {
	td, err := rp.jwtTokenManager.CreateTokens(userID)
	if err != nil {
		return nil, err
	}

	err = rp.saveTokens(userID, td)
	if err != nil {
		return nil, err
	}

	return td, nil
}

func (rp *RedisProvider) RefreshTokens(strRefreshToken string) (*TokenDetails, error) {
	jwtRefreshToken, err := rp.jwtTokenManager.ParseToken(strRefreshToken, rp.jwtTokenManager.refreshKeyFunc)
	if err != nil {
		if err == ErrExpiredToken {
			return nil, err
		}

		return nil, fmt.Errorf("Token verification error: %v", err)
	}

	//check if token exists in Redis
	exists, err := rp.tokenExists(jwtRefreshToken.UserID, jwtRefreshToken.UUID, refreshTokensPrefix)
	if err != nil {
		return nil, fmt.Errorf("Error checking token in Redis: %v", err)
	}

	if !exists {
		return nil, ErrUnknownToken
	}

	//delete tokens
	err = rp.deleteToken(jwtRefreshToken.UserID, jwtRefreshToken.UUID, refreshTokensPrefix, accessTokensPrefix)
	if err != nil {
		logging.SystemErrorf("Error deleting refresh [%s] and access tokens from Redis: %v", jwtRefreshToken.UUID, err)
		return nil, err
	}

	return rp.CreateTokens(jwtRefreshToken.UserID)
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

func (rp *RedisProvider) saveTokens(userID string, td *TokenDetails) error {
	//access
	err := rp.saveToken(userID, td.AccessToken.UUID, td.RefreshToken.UUID, accessTokensPrefix)
	if err != nil {
		return err
	}

	//refresh
	err = rp.saveToken(userID, td.RefreshToken.UUID, td.AccessToken.UUID, refreshTokensPrefix)
	if err != nil {
		return err
	}

	return nil
}

func (rp *RedisProvider) saveToken(userID, mainTokenID, secondaryTokenID, keyPrefix string) error {
	conn := rp.pool.Get()
	defer conn.Close()

	_, err := conn.Do("HSET", keyPrefix+":user#"+userID, mainTokenID, secondaryTokenID)
	if err != nil && err != redis.ErrNil {
		return err
	}

	_, err = conn.Do("EXPIRE", keyPrefix+":user#"+userID, RefreshTokenTTL.Seconds())
	if err != nil && err != redis.ErrNil {
		return err
	}

	return nil
}

func (rp *RedisProvider) tokenExists(userID, tokenID, keyPrefix string) (bool, error) {
	conn := rp.pool.Get()
	defer conn.Close()

	exists, err := redis.Bool(conn.Do("HEXISTS", keyPrefix+":user#"+userID, tokenID))
	if err != nil && err != redis.ErrNil {
		return false, err
	}

	return exists, nil
}

//deleteToken remove main and secondary (access and refresh) tokens from Redis
func (rp *RedisProvider) deleteToken(userID, tokenID, mainKeyPrefix, secondaryKeyPrefix string) error {
	conn := rp.pool.Get()
	defer conn.Close()

	secondaryToken, err := redis.String(conn.Do("HGET", mainKeyPrefix+":user#"+userID, tokenID))
	if err != nil && err != redis.ErrNil {
		return err
	}

	_, err = conn.Do("HDEL", mainKeyPrefix+":user#"+userID, tokenID)
	if err != nil && err != redis.ErrNil {
		return err
	}

	_, err = conn.Do("HDEL", secondaryKeyPrefix+":user#"+userID, secondaryToken)
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
