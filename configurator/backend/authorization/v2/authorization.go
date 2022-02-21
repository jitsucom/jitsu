package v2

import (
	"github.com/pkg/errors"
)

var (
	ErrUserExists   = errors.New("user exists")
	ErrUserNotFound = errors.New("user not found")
)

type MailSender interface {
	IsConfigured() bool
	SendResetPassword(email, link string) error
}
