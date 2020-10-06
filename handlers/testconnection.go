package handlers

import (
	"context"
	"encoding/json"
	"github.com/gin-gonic/gin"
	"github.com/ksensehq/eventnative/adapters"
	"net/http"
)

type ConnectionConfig struct {
	DestinationType  string                 `json:"type"`
	ConnectionConfig map[string]interface{} `json:"config"`
}

type ConnectionTestHandler struct {
}

func testConnection(config ConnectionConfig) error {
	switch config.DestinationType {
	case "postgres":
		var postgresConfig adapters.DataSourceConfig
		body, err := json.Marshal(config.ConnectionConfig)
		if err != nil {
			return err
		}
		err = json.Unmarshal(body, &postgresConfig)
		if err != nil {
			return err
		}
		//host := config.ConnectionParameters["host"].(string)
		//port := config.ConnectionParameters["port"].(int)
		//database := config.ConnectionParameters["database"].(string)
		//username := config.ConnectionParameters["username"].(string)
		//password := config.ConnectionParameters["password"].(string)
		//schema := config.ConnectionParameters["schema"].(string)
		//
		//dsConfig := adapters.DataSourceConfig{Host: host, Port: port, Db: database, Username: username, Password: password, Schema: schema}
		postgres, err := adapters.NewPostgres(context.Background(), &postgresConfig)
		if err != nil {
			return err
		}
		defer postgres.Close()
		return postgres.Test()

	}
	return nil

}

type OkResponse struct {
	Status string `json:"status"`
}

type ErrorResponse struct {
	Message string `json:"message"`
	Error   error  `'json:"error"`
}

func NewConnectionTestHandler() *ConnectionTestHandler {
	return &ConnectionTestHandler{}
}

func (h *ConnectionTestHandler) Handler(c *gin.Context) {
	connectionConfig := ConnectionConfig{}
	if err := c.BindJSON(&connectionConfig); err != nil {
		c.JSON(http.StatusBadRequest, ErrorResponse{Message: "Failed to parse body", Error: err})
		return
	}
	err := testConnection(connectionConfig)
	if err != nil {
		c.JSON(http.StatusBadRequest, ErrorResponse{Message: "Failed to test connection", Error: err})
		return
	}
	c.JSON(http.StatusOK, OkResponse{Status: "Connection established"})
}
