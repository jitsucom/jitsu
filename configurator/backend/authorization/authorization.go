package authorization

import (
	"io"

	"github.com/jitsucom/jitsu/configurator/handlers"
	"github.com/pkg/errors"
)

const (
	BoxyHQName = "boxyhq"
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

type SSOConfig struct {
	Provider              string `json:"provider" validate:"required"`
	Tenant                string `json:"tenant" validate:"required"`
	Product               string `json:"product" validate:"required"`
	Host                  string `json:"host" validate:"required"`
	AccessTokenTTLSeconds int    `json:"access_token_ttl_seconds" validate:"required"`
}

func closeQuietly(closer io.Closer) {
	_ = closer.Close()
}
