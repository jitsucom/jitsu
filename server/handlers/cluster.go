package handlers

import (
	"github.com/gin-gonic/gin"
	"github.com/jitsucom/eventnative/server/cluster"
	"github.com/jitsucom/eventnative/server/middleware"
	"net/http"
)

type ClusterInfo struct {
	Instances []InstanceInfo `json:"instances"`
}

type InstanceInfo struct {
	Name string `json:"name"`
}

type ClusterHandler struct {
	manager cluster.Manager
}

func NewClusterHandler(manager cluster.Manager) *ClusterHandler {
	return &ClusterHandler{
		manager: manager,
	}
}

func (ch *ClusterHandler) Handler(c *gin.Context) {
	instanceNames, err := ch.manager.GetInstances()
	if err != nil {
		c.JSON(http.StatusBadRequest, middleware.ErrorResponse{Message: "Error getting cluster info", Error: err.Error()})
		return
	}

	instances := []InstanceInfo{}
	for _, name := range instanceNames {
		instances = append(instances, InstanceInfo{Name: name})
	}

	c.JSON(http.StatusOK, ClusterInfo{Instances: instances})
}
