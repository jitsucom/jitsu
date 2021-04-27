package handlers

import (
	"encoding/json"
	"github.com/gin-gonic/gin"
	enmiddleware "github.com/jitsucom/jitsu/server/middleware"
	"github.com/jitsucom/jitsu/server/notifications"
	"net/http"
)

//NotifyHandler proxies notification payload to notifier
func NotifyHandler(c *gin.Context) {
	data := map[string]interface{}{}
	if err := c.BindJSON(&data); err != nil {
		c.Writer.WriteHeader(http.StatusBadRequest)
		return
	}

	b, _ := json.MarshalIndent(data, "", "\t")

	notifications.Custom(string(b))

	c.JSON(http.StatusOK, enmiddleware.OkResponse())
}
