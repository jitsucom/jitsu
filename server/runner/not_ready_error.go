package runner

import "errors"

var ErrNotReady = errors.New("not ready")

type CompositeNotReadyError struct {
	previousError string
}

func NewCompositeNotReadyError(previousError string) *CompositeNotReadyError {
	return &CompositeNotReadyError{previousError: previousError}
}

//Error returns not ready error
func (cnre *CompositeNotReadyError) Error() string {
	msg := ErrNotReady.Error()
	if cnre.previousError != "" {
		msg += ": " + cnre.previousError
	}

	return msg
}

//PreviousError returns previous error
func (cnre *CompositeNotReadyError) PreviousError() string {
	return cnre.previousError
}
