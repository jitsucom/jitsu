package utils

type RichError struct {
	error   string
	payload interface{}
}

func NewRichError(error string, payload interface{}) *RichError {
	return &RichError{error: error, payload: payload}
}

func (r *RichError) Error() string {
	return r.error
}

func (r *RichError) Payload() interface{} {
	return r.payload
}
