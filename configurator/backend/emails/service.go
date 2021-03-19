package emails

import (
	"bytes"
	"errors"
	"fmt"
	"github.com/jitsucom/jitsu/server/logging"
	gomail "gopkg.in/mail.v2"
	"text/template"
)

var ErrSMTPNotConfigured = errors.New("SMTP isn't configured")

type SmtpConfiguration struct {
	Host     string
	Port     int
	User     string
	Password string
}

func (sc *SmtpConfiguration) Validate() error {
	if sc.Host == "" {
		return errors.New("smtp host is required")
	}

	if sc.Port == 0 {
		return errors.New("smtp port is required")
	}

	if sc.User == "" {
		return errors.New("smtp user is required")
	}

	return nil
}

type Service struct {
	smtp               *SmtpConfiguration
	resetPasswordEmail *template.Template
}

func NewService(smtp *SmtpConfiguration) (*Service, error) {
	if smtp != nil {
		logging.Info("Initializing SMTP email service..")
	}

	t, err := template.New("reset_password_email").Parse(resetPasswordTemplate)
	if err != nil {
		return nil, fmt.Errorf("Error parsing reset password email template: %v", err)
	}

	return &Service{smtp: smtp, resetPasswordEmail: t}, nil
}

func (s *Service) IsConfigured() bool {
	return s.smtp != nil
}

func (s *Service) SendResetPassword(email, link string) error {
	if s.smtp == nil {
		return ErrSMTPNotConfigured
	}

	m := gomail.NewMessage()

	// Set E-Mail sender
	m.SetHeader("From", "support@jitsu.com")

	// Set E-Mail receivers
	m.SetHeader("To", email)

	// Set E-Mail subject
	m.SetHeader("Subject", "Reset your password for Jitsu - an open-source data collection platform")

	var body bytes.Buffer
	err := s.resetPasswordEmail.Execute(&body, struct {
		Email string
		Link  string
	}{
		Email: email,
		Link:  link,
	})

	if err != nil {
		return err
	}

	// Set E-Mail body. You can set plain text or html with text/html
	m.SetBody("text/html", body.String())

	// Settings for SMTP server
	d := gomail.NewDialer(s.smtp.Host, s.smtp.Port, s.smtp.User, s.smtp.Password)

	// Now send E-Mail
	if err := d.DialAndSend(m); err != nil {
		return fmt.Errorf("Error sending email to %s: %v", email, err)
	}

	return nil
}
