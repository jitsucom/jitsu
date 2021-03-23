package handlers

import (
	"errors"
	"github.com/gin-gonic/gin"
	"github.com/jitsucom/jitsu/configurator/authorization"
	"github.com/jitsucom/jitsu/configurator/emails"
	"github.com/jitsucom/jitsu/configurator/middleware"
	"github.com/jitsucom/jitsu/configurator/storages"
	"github.com/jitsucom/jitsu/server/logging"
	mdlwr "github.com/jitsucom/jitsu/server/middleware"
	"github.com/jitsucom/jitsu/server/telemetry"
	"net/http"
	"strings"
)

type ChangePasswordRequest struct {
	NewPassword string `json:"new_password"`
	ResetId     string `json:"reset_id"`
}

func (cpr *ChangePasswordRequest) Validate() error {
	if cpr.ResetId == "" {
		return errors.New("reset_id is required field")
	}

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
	UserId       string `json:"user_id"`
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
	configStorage storages.ConfigurationsStorage
}

func NewAuthorizationHandler(authService *authorization.Service, emailService *emails.Service, configStorage storages.ConfigurationsStorage) *AuthorizationHandler {
	return &AuthorizationHandler{emailService: emailService, authService: authService, configStorage: configStorage}
}

func (ah *AuthorizationHandler) SignIn(c *gin.Context) {
	req := &SignRequest{}
	if err := c.BindJSON(req); err != nil {
		c.JSON(http.StatusBadRequest, mdlwr.ErrorResponse{Message: "Invalid input JSON", Error: err.Error()})
		return
	}

	err := req.Validate()
	if err != nil {
		c.JSON(http.StatusBadRequest, mdlwr.ErrorResponse{Message: "Invalid input data", Error: err.Error()})
		return
	}

	td, err := ah.authService.SignIn(req.Email, req.Password)
	if err != nil {
		if err == authorization.ErrUserNotFound {
			c.JSON(http.StatusUnauthorized, mdlwr.ErrorResponse{Error: err.Error()})
			return
		}

		if err == authorization.ErrIncorrectPassword {
			c.JSON(http.StatusBadRequest, mdlwr.ErrorResponse{Error: err.Error()})
			return
		}

		c.JSON(http.StatusInternalServerError, mdlwr.ErrorResponse{Error: err.Error()})
		return
	}

	c.JSON(http.StatusOK, TokensResponse{AccessToken: td.AccessToken.Token, RefreshToken: td.RefreshToken.Token, UserId: td.AccessToken.UserId})
}

//OnboardedSignUp is used only for self-hosted
func (ah *AuthorizationHandler) OnboardedSignUp(c *gin.Context) {
	req := &SignUpRequest{}
	if err := c.BindJSON(req); err != nil {
		c.JSON(http.StatusBadRequest, mdlwr.ErrorResponse{Message: "Invalid input JSON", Error: err.Error()})
		return
	}

	err := req.Validate()
	if err != nil {
		c.JSON(http.StatusBadRequest, mdlwr.ErrorResponse{Message: "Invalid input data", Error: err.Error()})
		return
	}

	td, err := ah.authService.SignUp(req.Email, req.Password)
	if err != nil {
		if err == authorization.ErrUserExists {
			c.JSON(http.StatusBadRequest, mdlwr.ErrorResponse{Error: err.Error()})
			return
		}

		c.JSON(http.StatusInternalServerError, mdlwr.ErrorResponse{Error: err.Error()})
		return
	}

	//store telemetry settings
	err = ah.configStorage.Store(telemetryCollection, telemetryGlobalId, map[string]interface{}{"disabled": map[string]bool{"usage": req.UsageOptout}})
	if err != nil {
		logging.Errorf("Error saving telemetry configuration [%v] to storage: %v", req.UsageOptout, err)
	}

	//telemetry user
	user := &telemetry.UserData{
		Email:       req.Email,
		Name:        req.Name,
		Company:     req.Company,
		EmailOptout: req.EmailOptout,
		UsageOptout: req.UsageOptout,
	}
	telemetry.User(user)

	c.JSON(http.StatusOK, TokensResponse{AccessToken: td.AccessToken.Token, RefreshToken: td.RefreshToken.Token, UserId: td.AccessToken.UserId})
}

func (ah *AuthorizationHandler) SignUp(c *gin.Context) {
	req := &SignRequest{}
	if err := c.BindJSON(req); err != nil {
		c.JSON(http.StatusBadRequest, mdlwr.ErrorResponse{Message: "Invalid input JSON", Error: err.Error()})
		return
	}

	err := req.Validate()
	if err != nil {
		c.JSON(http.StatusBadRequest, mdlwr.ErrorResponse{Message: "Invalid input data", Error: err.Error()})
		return
	}

	td, err := ah.authService.SignUp(req.Email, req.Password)
	if err != nil {
		if err == authorization.ErrUserExists {
			c.JSON(http.StatusBadRequest, mdlwr.ErrorResponse{Error: err.Error()})
			return
		}

		c.JSON(http.StatusInternalServerError, mdlwr.ErrorResponse{Error: err.Error()})
		return
	}

	c.JSON(http.StatusOK, TokensResponse{AccessToken: td.AccessToken.Token, RefreshToken: td.RefreshToken.Token, UserId: td.AccessToken.UserId})
}

func (ah *AuthorizationHandler) SignOut(c *gin.Context) {
	token := c.GetString(middleware.TokenKey)

	err := ah.authService.SignOut(token)
	if err != nil {
		c.JSON(http.StatusInternalServerError, mdlwr.ErrorResponse{Error: err.Error()})
		return
	}

	c.Status(http.StatusOK)
}

//ResetPassword (if smtp configured) send an email and return reset ID
//otherwise return error
func (ah *AuthorizationHandler) ResetPassword(c *gin.Context) {
	if !ah.emailService.IsConfigured() {
		c.JSON(http.StatusBadRequest, mdlwr.ErrorResponse{Message: "SMTP isn't configured"})
		return
	}

	req := &PasswordResetRequest{}
	if err := c.BindJSON(req); err != nil {
		c.JSON(http.StatusBadRequest, mdlwr.ErrorResponse{Message: "Invalid input JSON", Error: err.Error()})
		return
	}

	if req.Email == "" {
		c.JSON(http.StatusBadRequest, mdlwr.ErrorResponse{Message: "email is required"})
		return
	}

	if req.Callback == "" {
		c.JSON(http.StatusBadRequest, mdlwr.ErrorResponse{Message: "callback is required"})
		return
	}

	resetId, email, err := ah.authService.CreateResetId(req.Email)
	if err != nil {
		if err == authorization.ErrUserNotFound {
			c.JSON(http.StatusBadRequest, mdlwr.ErrorResponse{Message: err.Error()})
			return
		}

		c.JSON(http.StatusInternalServerError, mdlwr.ErrorResponse{Error: err.Error()})
		return
	}

	err = ah.emailService.SendResetPassword(email, strings.ReplaceAll(req.Callback, "{{token}}", resetId))
	if err != nil {
		c.JSON(http.StatusInternalServerError, mdlwr.ErrorResponse{Message: "Error sending email message", Error: err.Error()})
		return
	}

	c.Status(http.StatusOK)
}

func (ah *AuthorizationHandler) ChangePassword(c *gin.Context) {
	req := &ChangePasswordRequest{}
	if err := c.BindJSON(req); err != nil {
		c.JSON(http.StatusBadRequest, mdlwr.ErrorResponse{Message: "Invalid input JSON", Error: err.Error()})
		return
	}

	err := req.Validate()
	if err != nil {
		c.JSON(http.StatusBadRequest, mdlwr.ErrorResponse{Message: "Invalid input data", Error: err.Error()})
		return
	}

	td, err := ah.authService.ChangePassword(req.ResetId, req.NewPassword)
	if err != nil {
		if err == authorization.ErrResetIdNotFound {
			c.JSON(http.StatusBadRequest, mdlwr.ErrorResponse{Message: "The link has been expired!"})
			return
		}

		c.JSON(http.StatusInternalServerError, mdlwr.ErrorResponse{Message: err.Error()})
		return
	}

	c.JSON(http.StatusOK, TokensResponse{AccessToken: td.AccessToken.Token, RefreshToken: td.RefreshToken.Token, UserId: td.AccessToken.UserId})
}

func (ah *AuthorizationHandler) RefreshToken(c *gin.Context) {
	req := &RefreshRequest{}
	if err := c.BindJSON(req); err != nil {
		c.JSON(http.StatusBadRequest, mdlwr.ErrorResponse{Message: "Invalid input JSON", Error: err.Error()})
		return
	}

	if req.RefreshToken == "" {
		c.JSON(http.StatusBadRequest, mdlwr.ErrorResponse{Message: "Invalid data JSON", Error: "refresh_token is required field"})
		return
	}

	td, err := ah.authService.Refresh(req.RefreshToken)
	if err != nil {
		if err == authorization.ErrUnknownToken {
			c.JSON(http.StatusUnauthorized, mdlwr.ErrorResponse{Message: authorization.ErrUnknownToken.Error()})
			return
		}

		c.JSON(http.StatusInternalServerError, mdlwr.ErrorResponse{Error: err.Error()})
		return
	}

	c.JSON(http.StatusOK, TokensResponse{AccessToken: td.AccessToken.Token, RefreshToken: td.RefreshToken.Token, UserId: td.AccessToken.UserId})
}
