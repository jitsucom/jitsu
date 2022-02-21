package authorization

import (
	"github.com/jitsucom/jitsu/server/timestamp"
	uuid "github.com/satori/go.uuid"
	"time"
)

const (
	//AccessTokenType is a token type only for debugging purpose
	AccessTokenType = "access_token"
	//RefreshTokenType is a token type only for debugging purpose
	RefreshTokenType = "refresh_token"
)

type TokenManager struct{}

func (tm *TokenManager) CreateAccessToken(userID string, accessTokenTTL time.Duration) *TokenEntity {
	return &TokenEntity{
		UserID:      userID,
		ExpiredAt:   timestamp.ToISOFormat(timestamp.Now().UTC().Add(accessTokenTTL)),
		AccessToken: uuid.NewV4().String(),
		TokenType:   AccessTokenType,
	}
}

func (tm *TokenManager) CreateRefreshToken(userID string, refreshTokenTTL time.Duration) *TokenEntity {
	return &TokenEntity{
		UserID:       userID,
		ExpiredAt:    timestamp.ToISOFormat(timestamp.Now().UTC().Add(refreshTokenTTL)),
		RefreshToken: uuid.NewV4().String(),
		TokenType:    RefreshTokenType,
	}
}
