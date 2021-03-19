package handlers

import (
	"github.com/gin-gonic/gin"
	"github.com/jitsucom/jitsu/configurator/authorization"
	"github.com/jitsucom/jitsu/server/middleware"
	"net/http"
)

//Configuration is used for system endpoint
//current authorization configuration and amount of registered users
type Configuration struct {
	Authorization   string `json:"authorization"`
	Users           bool   `json:"users"`
	Smtp            bool   `json:"smtp"`
	SelfHosted      bool   `json:"selfhosted"`
	SupportWidget   bool   `json:"support_widget"`
	DefaultS3Bucket bool   `json:"default_s3_bucket"`
}

type SystemHandler struct {
	authService *authorization.Service
	smtp        bool
	selfHosted  bool
}

type ConfigurationResponse struct {
	ProjectId string `json:"projectId"`
}

func NewSystemHandler(authService *authorization.Service, smtp, selfHosted bool) *SystemHandler {
	return &SystemHandler{authService: authService, smtp: smtp, selfHosted: selfHosted}
}

//ConfigurationHandler return JSON with current authorization type and users existence
func (sh *SystemHandler) GetHandler(c *gin.Context) {
	exist, err := sh.authService.UsersExist()
	if err != nil {
		c.JSON(http.StatusInternalServerError, middleware.ErrorResponse{
			Message: "Error checking users existence",
			Error:   err.Error(),
		})
		return
	}

	currentConfiguration := Configuration{
		Authorization:   sh.authService.GetAuthorizationType(),
		Users:           exist,
		Smtp:            sh.smtp,
		SelfHosted:      sh.selfHosted,
		SupportWidget:   !sh.selfHosted,
		DefaultS3Bucket: !sh.selfHosted,
	}

	c.JSON(http.StatusOK, currentConfiguration)
}
