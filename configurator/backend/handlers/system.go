package handlers

import (
	"github.com/gin-gonic/gin"
	"github.com/jitsucom/jitsu/configurator/authorization"
	"github.com/jitsucom/jitsu/configurator/storages"
	jmiddleware "github.com/jitsucom/jitsu/server/middleware"
	jsystem "github.com/jitsucom/jitsu/server/system"
	"net/http"
)

type Version struct {
	Version string `json:"version"`
	BuiltAt string `json:"builtAt"`
}

type SystemHandler struct {
	authService          *authorization.Service
	configurationService *storages.ConfigurationsService
	smtp                 bool
	selfHosted           bool
	dockerHubID          string
	tag                  string
	builtAt              string
}

type ConfigurationResponse struct {
	ProjectID string `json:"projectID"`
}

func NewSystemHandler(authService *authorization.Service, configurationService *storages.ConfigurationsService,
	smtp, selfHosted bool, dockerHubID string, tag string, buildAt string) *SystemHandler {
	return &SystemHandler{
		authService:          authService,
		configurationService: configurationService,
		smtp:                 smtp,
		selfHosted:           selfHosted,
		dockerHubID:          dockerHubID,
		tag:                  tag,
		builtAt:              buildAt,
	}
}

//GetConfiguration returns JSON with current authorization type and users existence
func (sh *SystemHandler) GetConfiguration(c *gin.Context) {
	exist, err := sh.authService.UsersExist()
	if err != nil {
		c.JSON(http.StatusInternalServerError, jmiddleware.ErrResponse("Error checking users existence", err))
		return
	}

	telemetryConfig, err := sh.configurationService.GetParsedTelemetry()
	if err != nil && err != storages.ErrConfigurationNotFound {
		c.JSON(http.StatusInternalServerError, jmiddleware.ErrResponse("Error getting telemetry configuration", err))
		return
	}

	var telemetryUsageDisabled bool
	if telemetryConfig != nil && telemetryConfig.Disabled != nil {
		usageDisabled, ok := telemetryConfig.Disabled[telemetryUsageKey]
		if ok {
			telemetryUsageDisabled = usageDisabled
		}
	}

	currentConfiguration := jsystem.Configuration{
		Authorization:          sh.authService.GetAuthorizationType(),
		Users:                  exist,
		SMTP:                   sh.smtp,
		SelfHosted:             sh.selfHosted,
		SupportWidget:          !sh.selfHosted,
		DefaultS3Bucket:        !sh.selfHosted,
		SupportTrackingDomains: !sh.selfHosted,
		TelemetryUsageDisabled: telemetryUsageDisabled,
		ShowBecomeUser:         !sh.selfHosted,
		DockerHubID:            sh.dockerHubID,
		Tag:                    sh.tag,
		BuiltAt:                sh.builtAt,
	}

	c.JSON(http.StatusOK, currentConfiguration)
}

//GetSystemVersion returns current Jitsu version
func (sh *SystemHandler) GetSystemVersion(c *gin.Context) {
	c.JSON(http.StatusOK, Version{Version: sh.tag, BuiltAt: sh.builtAt})
}
