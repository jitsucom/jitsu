package authorization

import (
	"errors"
	"fmt"
	"github.com/dgrijalva/jwt-go"
	uuid "github.com/satori/go.uuid"
	"time"
)

const (
	AccessTokenTTL  = time.Hour
	RefreshTokenTTL = time.Hour * 24 * 7
)

type JwtTokenManager struct {
	accessSecret  []byte
	refreshSecret []byte
}

func NewTokenManager(accessSecret, refreshSecret string) *JwtTokenManager {
	return &JwtTokenManager{
		accessSecret:  []byte(accessSecret),
		refreshSecret: []byte(refreshSecret),
	}
}

func (jtm *JwtTokenManager) CreateTokens(userId string) (td *TokenDetails, err error) {
	td = &TokenDetails{AccessToken: &JwtToken{UserId: userId}, RefreshToken: &JwtToken{UserId: userId}}
	td.AccessToken.Exp = time.Now().Add(AccessTokenTTL).Unix()
	td.AccessToken.UUID = uuid.NewV4().String()

	td.RefreshToken.Exp = time.Now().Add(RefreshTokenTTL).Unix()
	td.RefreshToken.UUID = uuid.NewV4().String()

	atClaims := jwt.MapClaims{}
	atClaims["uuid"] = td.AccessToken.UUID
	atClaims["user_id"] = userId
	atClaims["exp"] = td.AccessToken.Exp
	at := jwt.NewWithClaims(jwt.SigningMethodHS256, atClaims)
	td.AccessToken.Token, err = at.SignedString(jtm.accessSecret)
	if err != nil {
		return nil, err
	}

	rtClaims := jwt.MapClaims{}
	rtClaims["uuid"] = td.RefreshToken.UUID
	rtClaims["user_id"] = userId
	rtClaims["exp"] = td.RefreshToken.Exp
	rt := jwt.NewWithClaims(jwt.SigningMethodHS256, rtClaims)
	td.RefreshToken.Token, err = rt.SignedString(jtm.refreshSecret)
	if err != nil {
		return nil, err
	}

	return td, nil
}

func (jtm *JwtTokenManager) ParseToken(strToken string, keyFunc func(token *jwt.Token) (interface{}, error)) (*JwtToken, error) {
	token, err := jwt.Parse(strToken, keyFunc)
	if err != nil {
		jwve, ok := err.(*jwt.ValidationError)
		if ok {
			if jwve.Errors == jwt.ValidationErrorExpired {
				return nil, ErrExpiredToken
			}
		}

		return nil, err
	}

	claims, ok := token.Claims.(jwt.MapClaims)
	if !ok || !token.Valid {
		return nil, errors.New("Invalid token claims")
	}

	accessUuid, ok := claims["uuid"]
	if !ok {
		return nil, errors.New("Invalid token uuid")
	}

	userId, ok := claims["user_id"]
	if !ok {
		return nil, errors.New("Invalid user_id")
	}

	exp, ok := claims["exp"]
	if !ok {
		return nil, errors.New("Invalid exp")
	}

	expFloat, ok := exp.(float64)
	if !ok {
		return nil, fmt.Errorf("Invalid exp type: expeceted float64, but received: %T", exp)
	}

	return &JwtToken{
		Token:  strToken,
		UUID:   fmt.Sprint(accessUuid),
		Exp:    int64(expFloat),
		UserId: fmt.Sprint(userId),
	}, nil
}

func (jtm *JwtTokenManager) accessKeyFunc(token *jwt.Token) (interface{}, error) {
	//Make sure that the token method conform to "SigningMethodHMAC"
	if _, ok := token.Method.(*jwt.SigningMethodHMAC); !ok {
		return nil, fmt.Errorf("unexpected signing method: %v", token.Header["alg"])
	}
	return jtm.accessSecret, nil
}

func (jtm *JwtTokenManager) refreshKeyFunc(token *jwt.Token) (interface{}, error) {
	//Make sure that the token method conform to "SigningMethodHMAC"
	if _, ok := token.Method.(*jwt.SigningMethodHMAC); !ok {
		return nil, fmt.Errorf("unexpected signing method: %v", token.Header["alg"])
	}
	return jtm.refreshSecret, nil
}
