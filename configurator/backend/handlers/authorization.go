package handlers

import (
	"errors"
	"github.com/gin-gonic/gin"
	"github.com/jitsucom/jitsu/configurator/authorization"
	"github.com/jitsucom/jitsu/configurator/emails"
	"github.com/jitsucom/jitsu/configurator/middleware"
	"github.com/jitsucom/jitsu/configurator/storages"
	"github.com/jitsucom/jitsu/server/logging"
	jmiddleware "github.com/jitsucom/jitsu/server/middleware"
	"github.com/jitsucom/jitsu/server/telemetry"
	"net/http"
	"strings"
)

type ChangePasswordRequest struct {
	NewPassword string `json:"new_password"`
	ResetID     string `json:"reset_id"`
}

func (cpr *ChangePasswordRequest) Validate() error {
	if cpr.NewPassword == "" {
		return errors.New("new_password is required field")
	}

	return nil
}

type PasswordResetRequest struct {
	Email    string `json:"email"`
	Callback string `json:"callback"`
}

type TokensResponse struct {
	AccessToken  string `json:"access_token"`
	RefreshToken string `json:"refresh_token"`
	UserID       string `json:"user_id"`
}

type SignRequest struct {
	Email    string `json:"email"`
	Password string `json:"password"`
}

func (sr *SignRequest) Validate() error {
	if sr.Email == "" {
		return errors.New("email is required field")
	}

	if sr.Password == "" {
		return errors.New("password is required field")
	}

	return nil
}

type SignUpRequest struct {
	Email       string `json:"email"`
	Password    string `json:"password"`
	Name        string `json:"name"`
	Company     string `json:"company"`
	EmailOptout bool   `json:"emailOptout"`
	UsageOptout bool   `json:"usageOptout"`
}

func (sur *SignUpRequest) Validate() error {
	if sur.Email == "" {
		return errors.New("email is required field")
	}

	if sur.Password == "" {
		return errors.New("password is required field")
	}

	if sur.Name == "" {
		return errors.New("name is required field")
	}

	if sur.Company == "" {
		return errors.New("company is required field")
	}

	return nil
}

type RefreshRequest struct {
	RefreshToken string `json:"refresh_token"`
}

//AuthorizationHandler is used only for in-house authorization (Redis)
type AuthorizationHandler struct {
	emailService  *emails.Service
	authService   *authorization.Service
	configService *storages.ConfigurationsService
}

func NewAuthorizationHandler(authService *authorization.Service, emailService *emails.Service, configService *storages.ConfigurationsService) *AuthorizationHandler {
	return &AuthorizationHandler{emailService: emailService, authService: authService, configService: configService}
}

func (ah *AuthorizationHandler) SignIn(c *gin.Context) {
	req := &SignRequest{}
	if err := c.BindJSON(req); err != nil {
		c.JSON(http.StatusBadRequest, jmiddleware.ErrResponse("Invalid input JSON", err))
		return
	}

	err := req.Validate()
	if err != nil {
		c.JSON(http.StatusBadRequest, jmiddleware.ErrResponse("Invalid input data", err))
		return
	}

	td, err := ah.authService.SignIn(req.Email, req.Password)
	if err != nil {
		c.JSON(http.StatusUnauthorized, jmiddleware.ErrResponse(err.Error(), nil))
		return
	}

	c.JSON(http.StatusOK, TokensResponse{AccessToken: td.AccessToken.Token, RefreshToken: td.RefreshToken.Token, UserID: td.AccessToken.UserID})
}

//OnboardedSignUp is used only for self-hosted
func (ah *AuthorizationHandler) OnboardedSignUp(c *gin.Context) {
	req := &SignUpRequest{}
	if err := c.BindJSON(req); err != nil {
		c.JSON(http.StatusBadRequest, jmiddleware.ErrResponse("Invalid input JSON", err))
		return
	}

	err := req.Validate()
	if err != nil {
		c.JSON(http.StatusBadRequest, jmiddleware.ErrResponse("Invalid input data", err))
		return
	}

	td, err := ah.authService.SignUp(req.Email, req.Password)
	if err != nil {
		c.JSON(http.StatusBadRequest, jmiddleware.ErrResponse(err.Error(), nil))
		return
	}

	//store telemetry settings
	err = ah.configService.SaveTelemetry(map[string]bool{telemetryUsageKey: req.UsageOptout})
	if err != nil {
		logging.Errorf("Error saving telemetry configuration [%v] to storage: %v", req.UsageOptout, err)
	}

	//telemetry user
	user := &telemetry.UserData{
		Company:     req.Company,
		EmailOptout: req.EmailOptout,
		UsageOptout: req.UsageOptout,
	}
	if !req.EmailOptout {
		user.Email = req.Email
		user.Name = req.Name
	}
	telemetry.User(user)

	c.JSON(http.StatusOK, TokensResponse{AccessToken: td.AccessToken.Token, RefreshToken: td.RefreshToken.Token, UserID: td.AccessToken.UserID})
}

func (ah *AuthorizationHandler) SignUp(c *gin.Context) {
	req := &SignRequest{}
	if err := c.BindJSON(req); err != nil {
		c.JSON(http.StatusBadRequest, jmiddleware.ErrResponse("Invalid input JSON", err))
		return
	}

	err := req.Validate()
	if err != nil {
		c.JSON(http.StatusBadRequest, jmiddleware.ErrResponse("Invalid input data", err))
		return
	}

	td, err := ah.authService.SignUp(req.Email, req.Password)
	if err != nil {
		c.JSON(http.StatusBadRequest, jmiddleware.ErrResponse(err.Error(), nil))
		return
	}

	c.JSON(http.StatusOK, TokensResponse{AccessToken: td.AccessToken.Token, RefreshToken: td.RefreshToken.Token, UserID: td.AccessToken.UserID})
}

func (ah *AuthorizationHandler) SignOut(c *gin.Context) {
	token := c.GetString(middleware.TokenKey)

	err := ah.authService.SignOut(token)
	if err != nil {
		c.JSON(http.StatusBadRequest, jmiddleware.ErrResponse(err.Error(), nil))
		return
	}

	c.Status(http.StatusOK)
}

//ResetPassword (if smtp configured) send an email and return reset ID
//otherwise return error
func (ah *AuthorizationHandler) ResetPassword(c *gin.Context) {
	if !ah.emailService.IsConfigured() {
		c.JSON(http.StatusBadRequest, jmiddleware.ErrResponse("SMTP isn't configured", nil))
		return
	}

	req := &PasswordResetRequest{}
	if err := c.BindJSON(req); err != nil {
		c.JSON(http.StatusBadRequest, jmiddleware.ErrResponse("Invalid input JSON", err))
		return
	}

	if req.Email == "" {
		c.JSON(http.StatusBadRequest, jmiddleware.ErrResponse("email is required", nil))
		return
	}

	if req.Callback == "" {
		c.JSON(http.StatusBadRequest, jmiddleware.ErrResponse("callback is required", nil))
		return
	}

	resetID, email, err := ah.authService.CreateResetID(req.Email)
	if err != nil {
		if err == authorization.ErrUserNotFound {
			c.JSON(http.StatusBadRequest, jmiddleware.ErrResponse(err.Error(), nil))
			return
		}

		c.JSON(http.StatusInternalServerError, jmiddleware.ErrResponse(err.Error(), nil))
		return
	}

	err = ah.emailService.SendResetPassword(email, strings.ReplaceAll(req.Callback, "{{token}}", resetID))
	if err != nil {
		c.JSON(http.StatusInternalServerError, jmiddleware.ErrResponse("Error sending email message", err))
		return
	}

	c.Status(http.StatusOK)
}

func (ah *AuthorizationHandler) ChangePassword(c *gin.Context) {
	req := &ChangePasswordRequest{}
	if err := c.BindJSON(req); err != nil {
		c.JSON(http.StatusBadRequest, jmiddleware.ErrResponse("Invalid input JSON", err))
		return
	}

	err := req.Validate()
	if err != nil {
		c.JSON(http.StatusBadRequest, jmiddleware.ErrResponse("Invalid input data", err))
		return
	}

	token := c.GetHeader(middleware.ClientAuthHeader)

	td, err := ah.authService.ChangePassword(req.ResetID, token, req.NewPassword)
	if err != nil {
		if err == authorization.ErrResetIDNotFound {
			c.JSON(http.StatusBadRequest, jmiddleware.ErrResponse("The link has been expired!", nil))
			return
		}

		c.JSON(http.StatusBadRequest, jmiddleware.ErrResponse(err.Error(), nil))
		return
	}

	c.JSON(http.StatusOK, TokensResponse{AccessToken: td.AccessToken.Token, RefreshToken: td.RefreshToken.Token, UserID: td.AccessToken.UserID})
}

func (ah *AuthorizationHandler) RefreshToken(c *gin.Context) {
	req := &RefreshRequest{}
	if err := c.BindJSON(req); err != nil {
		c.JSON(http.StatusBadRequest, jmiddleware.ErrResponse("Invalid input JSON", err))
		return
	}

	if req.RefreshToken == "" {
		c.JSON(http.StatusBadRequest, jmiddleware.ErrResponse("Invalid data JSON", errors.New("refresh_token is required field")))
		return
	}

	td, err := ah.authService.Refresh(req.RefreshToken)
	if err != nil {
		c.JSON(http.StatusUnauthorized, jmiddleware.ErrResponse(err.Error(), nil))
		return
	}

	c.JSON(http.StatusOK, TokensResponse{AccessToken: td.AccessToken.Token, RefreshToken: td.RefreshToken.Token, UserID: td.AccessToken.UserID})
}
