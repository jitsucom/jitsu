package authorization

import (
	"time"

	"github.com/jitsucom/jitsu/server/timestamp"
	"github.com/pkg/errors"
	uuid "github.com/satori/go.uuid"
)

type tokenPairTTL struct {
	access  time.Duration
	refresh time.Duration
}

var defaultTokenPairTTL = tokenPairTTL{
	access:  24 * time.Hour,
	refresh: 7 * 24 * time.Hour,
}

type redisToken struct {
	UserID       string `json:"user_id"`
	ExpiredAt    string `json:"expired_at"`
	TokenType    string `json:"token_type"`
	AccessToken  string `json:"access_token"`
	RefreshToken string `json:"refresh_token"`
}

func (t *redisToken) validate() error {
	if expiredAt, err := timestamp.ParseISOFormat(t.ExpiredAt); err != nil {
		return errors.Wrap(err, "parse expiration field")
	} else if timestamp.Now().After(expiredAt) {
		return errExpiredToken
	} else {
		return nil
	}
}

type redisTokenType interface {
	key() string
	name() string
	get(token *redisToken) string
	set(token *redisToken, value string)
}

type _accessTokenType struct{}

func (_accessTokenType) key() string                         { return "auth_access_tokens" }
func (_accessTokenType) name() string                        { return "access_token" }
func (_accessTokenType) get(token *redisToken) string        { return token.AccessToken }
func (_accessTokenType) set(token *redisToken, value string) { token.AccessToken = value }

type _refreshTokenType struct{}

func (_refreshTokenType) key() string                         { return "auth_refresh_tokens" }
func (_refreshTokenType) name() string                        { return "refresh_token" }
func (_refreshTokenType) get(token *redisToken) string        { return token.RefreshToken }
func (_refreshTokenType) set(token *redisToken, value string) { token.RefreshToken = value }

var (
	accessTokenType  redisTokenType = _accessTokenType{}
	refreshTokenType redisTokenType = _refreshTokenType{}
)

func newRedisToken(now time.Time, userID string, tokenType redisTokenType, ttl time.Duration) *redisToken {
	token := &redisToken{
		UserID:    userID,
		ExpiredAt: timestamp.ToISOFormat(now.UTC().Add(ttl)),
		TokenType: tokenType.name(),
	}

	tokenType.set(token, uuid.NewV4().String())
	return token
}
