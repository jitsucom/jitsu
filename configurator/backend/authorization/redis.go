package authorization

import (
	"errors"
	"fmt"
	"github.com/gomodule/redigo/redis"
	"github.com/jitsucom/jitsu/server/logging"
	"strconv"
	"time"
)

const (
	accessTokensPrefix  = "jwt_access_tokens"
	refreshTokensPrefix = "jwt_refresh_tokens"
)

//** redis key [variables] - description **
//user#userId [email, salt.passwordhash] -
//users_index [email, id, email, id] hashtable where field = email and value = id
//jwt_access_tokens:user#userId [access_token_id, refresh_token_id, access_token_id, refresh_token_id] hashtable where field = access_token_id and value = refresh_token_id (TTL RefreshTokenTTL)
//jwt_refresh_tokens:user#userId [refresh_token_id, access_token_id, refresh_token_id, access_token_id] hashtable where field = refresh_token_id and value = access_token_id (TTL RefreshTokenTTL)
//password_reset#reset_id user_id 1 hour - key contains user_id with ttl = 1 hour

//RedisProvider provide authorization storage
type RedisProvider struct {
	jwtTokenManager *JwtTokenManager
	pool            *redis.Pool
}

func NewRedisProvider(host, password, accessSecret, refreshSecret string, port int) (*RedisProvider, error) {
	logging.Infof("Initializing redis authorization storage [%s:%d]...", host, port)
	r := &RedisProvider{pool: &redis.Pool{
		MaxIdle:     100,
		MaxActive:   600,
		IdleTimeout: 240 * time.Second,

		Wait: false,
		Dial: func() (redis.Conn, error) {
			c, err := redis.Dial(
				"tcp",
				host+":"+strconv.Itoa(port),
				redis.DialConnectTimeout(10*time.Second),
				redis.DialReadTimeout(10*time.Second),
				redis.DialPassword(password),
			)
			if err != nil {
				return nil, err
			}
			return c, err
		},
		TestOnBorrow: func(c redis.Conn, t time.Time) error {
			_, err := c.Do("PING")
			return err
		},
	},
		jwtTokenManager: NewTokenManager(accessSecret, refreshSecret),
	}

	//test connection
	connection := r.pool.Get()
	defer connection.Close()
	_, err := redis.String(connection.Do("PING"))
	if err != nil {
		return nil, fmt.Errorf("Error testing connection to Redis: %v", err)
	}

	return r, nil
}

//VerifyToken verify token
//return user id if token is valid
func (rp *RedisProvider) VerifyAccessToken(strToken string) (string, error) {
	jwtToken, err := rp.jwtTokenManager.ParseToken(strToken, rp.jwtTokenManager.accessKeyFunc)
	if err != nil {
		if err == ErrExpiredToken {
			return "", err
		}

		return "", fmt.Errorf("Token verification error: %v", err)
	}

	//check if token exists in Redis
	exists, err := rp.tokenExists(jwtToken.UserId, jwtToken.UUID, accessTokensPrefix)
	if err != nil {
		return "", fmt.Errorf("Error checking token in Redis: %v", err)
	}

	if !exists {
		return "", ErrUnknownToken
	}

	return jwtToken.UserId, nil
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

//GetUserIdByEmail return User by email
func (rp *RedisProvider) GetUserByEmail(email string) (*User, error) {
	conn := rp.pool.Get()
	defer conn.Close()

	//get userId from index
	userId, err := redis.String(conn.Do("HGET", "users_index", email))
	if err != nil {
		if err == redis.ErrNil {
			return nil, ErrUserNotFound
		}

		return nil, err
	}

	userValues, err := redis.Values(conn.Do("HGETALL", "user#"+userId))
	if err != nil {
		if err == redis.ErrNil {
			logging.SystemErrorf("User with id: %s exists in users_index but doesn't exist in user#%s record", userId, userId)
			return nil, ErrUserNotFound
		}

		return nil, err
	}

	user := &User{}
	err = redis.ScanStruct(userValues, user)
	if err != nil {
		return nil, fmt.Errorf("Error deserializing user entity [%s]: %v", userId, err)
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

func (rp *RedisProvider) DeleteAllTokens(userId string) error {
	conn := rp.pool.Get()
	defer conn.Close()

	//delete all access
	_, err := conn.Do("DEL", accessTokensPrefix+":user#"+userId)
	if err != nil && err != redis.ErrNil {
		return err
	}

	//delete all refresh
	_, err = conn.Do("DEL", refreshTokensPrefix+":user#"+userId)
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

	err = rp.deleteToken(jwtToken.UserId, jwtToken.UUID, accessTokensPrefix, refreshTokensPrefix)
	if err != nil {
		return err
	}

	return nil
}

func (rp *RedisProvider) CreateTokens(userId string) (*TokenDetails, error) {
	td, err := rp.jwtTokenManager.CreateTokens(userId)
	if err != nil {
		return nil, err
	}

	err = rp.saveTokens(userId, td)
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
	exists, err := rp.tokenExists(jwtRefreshToken.UserId, jwtRefreshToken.UUID, refreshTokensPrefix)
	if err != nil {
		return nil, fmt.Errorf("Error checking token in Redis: %v", err)
	}

	if !exists {
		return nil, ErrUnknownToken
	}

	//delete tokens
	err = rp.deleteToken(jwtRefreshToken.UserId, jwtRefreshToken.UUID, refreshTokensPrefix, accessTokensPrefix)
	if err != nil {
		logging.SystemErrorf("Error deleting refresh [%s] and access tokens from Redis: %v", jwtRefreshToken.UUID, err)
		return nil, err
	}

	return rp.CreateTokens(jwtRefreshToken.UserId)
}

//SavePasswordResetId save reset id with ttl 1 hour
func (rp *RedisProvider) SavePasswordResetId(resetId, userId string) error {
	conn := rp.pool.Get()
	defer conn.Close()

	_, err := conn.Do("SET", "password_reset#"+resetId, userId, "EX", 3600)
	if err != nil && err != redis.ErrNil {
		return err
	}

	return nil
}

//DeletePasswordResetId delete reset id
func (rp *RedisProvider) DeletePasswordResetId(resetId string) error {
	conn := rp.pool.Get()
	defer conn.Close()

	_, err := conn.Do("DEL", "password_reset#"+resetId)
	if err != nil && err != redis.ErrNil {
		return err
	}

	return nil
}

//GetUserByResetId return user from Redis
func (rp *RedisProvider) GetUserByResetId(resetId string) (*User, error) {
	conn := rp.pool.Get()
	defer conn.Close()

	//get userId
	userId, err := redis.String(conn.Do("GET", "password_reset#"+resetId))
	if err != nil {
		if err == redis.ErrNil {
			return nil, ErrResetIdNotFound
		}

		return nil, err
	}

	//get user
	userValues, err := redis.Values(conn.Do("HGETALL", "user#"+userId))
	if err != nil {
		if err == redis.ErrNil {
			logging.SystemErrorf("User with id: %s exists in reset password record [%s] but doesn't exist in user#%s record", userId, resetId, userId)
			return nil, err
		}

		return nil, err
	}

	user := &User{}
	err = redis.ScanStruct(userValues, user)
	if err != nil {
		return nil, fmt.Errorf("Error deserializing user entity [%s]: %v", userId, err)
	}

	return user, nil
}

func (rp *RedisProvider) saveTokens(userId string, td *TokenDetails) error {
	//access
	err := rp.saveToken(userId, td.AccessToken.UUID, td.RefreshToken.UUID, accessTokensPrefix)
	if err != nil {
		return err
	}

	//refresh
	err = rp.saveToken(userId, td.RefreshToken.UUID, td.AccessToken.UUID, refreshTokensPrefix)
	if err != nil {
		return err
	}

	return nil
}

func (rp *RedisProvider) saveToken(userId, mainTokenId, secondaryTokenId, keyPrefix string) error {
	conn := rp.pool.Get()
	defer conn.Close()

	_, err := conn.Do("HSET", keyPrefix+":user#"+userId, mainTokenId, secondaryTokenId)
	if err != nil && err != redis.ErrNil {
		return err
	}

	_, err = conn.Do("EXPIRE", keyPrefix+":user#"+userId, RefreshTokenTTL.Seconds())
	if err != nil && err != redis.ErrNil {
		return err
	}

	return nil
}

func (rp *RedisProvider) tokenExists(userId, tokenId, keyPrefix string) (bool, error) {
	conn := rp.pool.Get()
	defer conn.Close()

	exists, err := redis.Bool(conn.Do("HEXISTS", keyPrefix+":user#"+userId, tokenId))
	if err != nil && err != redis.ErrNil {
		return false, err
	}

	return exists, nil
}

//deleteToken remove main and secondary (access and refresh) tokens from Redis
func (rp *RedisProvider) deleteToken(userId, tokenId, mainKeyPrefix, secondaryKeyPrefix string) error {
	conn := rp.pool.Get()
	defer conn.Close()

	secondaryToken, err := redis.String(conn.Do("HGET", mainKeyPrefix+":user#"+userId, tokenId))
	if err != nil && err != redis.ErrNil {
		return err
	}

	_, err = conn.Do("HDEL", mainKeyPrefix+":user#"+userId, tokenId)
	if err != nil && err != redis.ErrNil {
		return err
	}

	_, err = conn.Do("HDEL", secondaryKeyPrefix+":user#"+userId, secondaryToken)
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
func (rp *RedisProvider) IsAdmin(userId string) (bool, error) {
	logging.SystemErrorf("IsAdmin isn't supported in authorization RedisProvider. userId: %s", userId)
	return false, nil
}

func (rp *RedisProvider) GenerateUserAccessToken(userId string) (string, error) {
	errMsg := fmt.Sprintf("GenerateUserToken isn't supported in authorization RedisProvider. userId: %s", userId)
	logging.SystemError(errMsg)
	return "", errors.New(errMsg)
}
