package middleware

import (
	"fmt"
	"github.com/jitsucom/jitsu/server/utils"
)

const (
	StatusOK      = "ok"
	StatusPending = "pending"
)

//ErrorResponse is a dto for sending error response
type ErrorResponse struct {
	Message string      `json:"message"`
	Payload interface{} `json:"payload,omitempty"`
	//Deprecated
	Error string `json:"error"`
}

//ErrResponse is a constructor for ErrorResponse
func ErrResponse(msg string, err error) *ErrorResponse {
	if err == nil {
		return &ErrorResponse{Message: msg}
	}
	if richErr, ok := err.(*utils.RichError); ok {
		return &ErrorResponse{
			Message: richErr.Error(),
			Payload: richErr.Payload(),
		}
	}
	if msg == "" {
		return &ErrorResponse{
			Message: err.Error(),
		}
	}
	return &ErrorResponse{
		Message: fmt.Sprintf("%s: %s", msg, err.Error()),
	}
}

//StatusResponse is a dto for sending operation status
type StatusResponse struct {
	Status  string `json:"status"`
	Message string `json:"message,omitempty"`
}

//OKResponse returns StatusResponse with Status = "ok"
func OKResponse() StatusResponse {
	return StatusResponse{Status: StatusOK}
}

//PendingResponse returns StatusResponse with Status = "pending"
func PendingResponse() StatusResponse {
	return StatusResponse{Status: StatusPending}
}
