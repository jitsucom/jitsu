package handlers

import (
	"github.com/gin-gonic/gin"
	"github.com/jitsucom/jitsu/configurator/authorization"
	"github.com/jitsucom/jitsu/configurator/middleware"
	mdlwr "github.com/jitsucom/jitsu/server/middleware"
	"net/http"
)

type BecomeUserHandler struct {
	authService *authorization.Service
}

type TokenResponse struct {
	Token string `json:"token"`
}

func NewBecomeUserHandler(authService *authorization.Service) *BecomeUserHandler {
	return &BecomeUserHandler{authService: authService}
}

//Handler is used only if firebase authorization
//becomeUser isn't supported with Redis authorization (without google authorization)
func (buh *BecomeUserHandler) Handler(c *gin.Context) {
	userId := c.GetString(middleware.UserIdKey)

	isAdmin, err := buh.authService.IsAdmin(userId)
	if err != nil {
		c.JSON(http.StatusUnauthorized, mdlwr.ErrorResponse{Error: err.Error()})
		return
	}

	if !isAdmin {
		c.JSON(http.StatusUnauthorized, mdlwr.ErrorResponse{Message: "Only admins may call this API"})
		return
	}

	becomingUserId := c.Query("user_id")
	userToken, err := buh.authService.GenerateUserToken(becomingUserId)
	if err != nil {
		c.JSON(http.StatusBadRequest, mdlwr.ErrorResponse{Error: err.Error()})
		return
	}

	c.JSON(http.StatusOK, TokenResponse{Token: userToken})
}
