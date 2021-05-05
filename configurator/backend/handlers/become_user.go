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
	userID := c.GetString(middleware.UserIDKey)

	isAdmin, err := buh.authService.IsAdmin(userID)
	if err != nil {
		c.JSON(http.StatusUnauthorized, mdlwr.ErrResponse(err.Error(), nil))
		return
	}

	if !isAdmin {
		c.JSON(http.StatusUnauthorized, mdlwr.ErrResponse("Only admins may call this API", nil))
		return
	}

	becomingUserID := c.Query("user_id")
	userToken, err := buh.authService.GenerateUserToken(becomingUserID)
	if err != nil {
		c.JSON(http.StatusBadRequest, mdlwr.ErrResponse(err.Error(), nil))
		return
	}

	c.JSON(http.StatusOK, TokenResponse{Token: userToken})
}
