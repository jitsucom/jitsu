package middleware

import (
	"errors"
)

const (
	ProjectIDQuery = "project_id"
)

var (
	ErrIsAnonymous = errors.New("please use personalized token for this call")
)

type ReadableError struct {
	Description string
	Cause       error
}

func (e ReadableError) Error() string {
	if e.Cause != nil {
		return e.Description + ": " + e.Cause.Error()
	}

	return e.Description
}

func (e ReadableError) Unwrap() error {
	return e.Cause
}
