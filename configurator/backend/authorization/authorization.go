package authorization

import (
	"github.com/jitsucom/jitsu/configurator/handlers"
	"github.com/pkg/errors"
)

var (
	ErrUserExists   = handlers.ErrUserExists
	ErrUserNotFound = errors.New("user not found")
)

type MailSender interface {
	IsConfigured() bool
	SendResetPassword(email, link string) error
	SendAccountCreated(email, link string) error
}
