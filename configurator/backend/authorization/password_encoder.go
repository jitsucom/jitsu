package authorization

import "golang.org/x/crypto/bcrypt"

type PasswordEncoder interface {
	Encode(value string) (string, error)
	Compare(encoded, raw string) error
}

type _bcrypt struct{}

func (_bcrypt) Encode(value string) (string, error) {
	if hash, err := bcrypt.GenerateFromPassword([]byte(value), bcrypt.MinCost); err != nil {
		return "", err
	} else {
		return string(hash), nil
	}
}

func (_bcrypt) Compare(encoded, raw string) error {
	return bcrypt.CompareHashAndPassword([]byte(encoded), []byte(raw))
}
