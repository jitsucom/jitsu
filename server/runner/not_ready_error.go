package runner

type NotReadyError struct {
	previousError string
}

func NewNotReadyError(previousError string) *NotReadyError {
	return &NotReadyError{previousError: previousError}
}

//Error returns not ready error
func (nre *NotReadyError) Error() string {
	msg := "not ready"
	if nre.previousError != "" {
		msg += ": " + nre.previousError
	}

	return msg
}

//PreviousError returns previous error
func (nre *NotReadyError) PreviousError() string {
	return nre.previousError
}
