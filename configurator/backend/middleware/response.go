package middleware

import (
	"fmt"
	jmiddleware "github.com/jitsucom/jitsu/server/middleware"
)

type OkResponse struct {
	Status string `json:"status"`
}

func ForbiddenProject(projectID string) *jmiddleware.ErrorResponse {
	return jmiddleware.ErrResponse(fmt.Sprintf("User does not have access to the project: %s", projectID), nil)
}
